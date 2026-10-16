"""AWS Lambda entrypoint and REST API router for Rapid Document Conversion.

Handles HTTP events from Amazon API Gateway, manages conversion workflows,
quality validation, storage integration, and serves the web interface.
"""

import os
import json
import uuid
import base64
import logging
from typing import Dict, Any, Optional

from .recommender import (
    SUPPORTED_CONVERSIONS,
    GOAL_DESCRIPTIONS,
    GOAL_PREFERENCES,
    recommend_format,
    normalize_format,
    is_conversion_supported,
)
from .converter import convert_document, ConversionError
from .validator import validate_conversion_quality
from .storage import get_storage_provider, sanitize_filename

logger = logging.getLogger()
logger.setLevel(logging.INFO)

CORS_ORIGIN = os.environ.get("CORS_ALLOW_ORIGIN", "*")
MAX_FILE_SIZE_MB = int(os.environ.get("MAX_FILE_SIZE_MB", "10"))
MAX_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024


def build_response(
    status_code: int,
    body: Any,
    content_type: str = "application/json",
    is_base64: bool = False,
    extra_headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Construct an API Gateway Lambda Proxy response with CORS headers."""
    headers = {
        "Content-Type": content_type,
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
        "Cache-Control": "no-cache, no-store, must-revalidate",
    }
    if extra_headers:
        headers.update(extra_headers)

    body_content = (
        json.dumps(body) if content_type == "application/json" and not isinstance(body, str) else body
    )

    return {
        "statusCode": status_code,
        "headers": headers,
        "body": body_content,
        "isBase64Encoded": is_base64,
    }


def _get_static_asset(filename: str) -> Optional[str]:
    """Read a frontend static asset from the package static directory."""
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    target = os.path.abspath(os.path.join(static_dir, filename))
    if not target.startswith(os.path.abspath(static_dir)):
        return None
    if os.path.isfile(target):
        with open(target, "r", encoding="utf-8") as f:
            return f.read()
    return None


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Main AWS Lambda proxy handler."""
    http_method = event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = event.get("path") or event.get("rawPath", "/")

    # Normalize trailing slash
    clean_path = path.rstrip("/") if path != "/" else "/"

    # Handle CORS Preflight
    if http_method == "OPTIONS":
        return build_response(200, {"message": "Preflight OK"})

    logger.info("Handling request: %s %s", http_method, clean_path)

    try:
        # Route 1: Web Interface HTML (Root)
        if clean_path in ("", "/") and http_method == "GET":
            html_content = _get_static_asset("index.html")
            if not html_content:
                return build_response(500, {"error": "Frontend UI file not found"})
            return build_response(200, html_content, content_type="text/html; charset=utf-8")

        # Route 2: Static CSS / JS
        if (clean_path.startswith("/static/") or clean_path in ("/style.css", "/app.js")) and http_method == "GET":
            asset_name = clean_path.replace("/static/", "").lstrip("/")
            content = _get_static_asset(asset_name)
            if not content:
                return build_response(404, {"error": "Asset not found"})
            content_type = "text/css" if asset_name.endswith(".css") else "application/javascript"
            return build_response(200, content, content_type=f"{content_type}; charset=utf-8")

        # Route 3: Health Check
        if clean_path == "/health" and http_method == "GET":
            return build_response(200, {
                "status": "healthy",
                "service": "Rapid Document Conversion",
                "version": "1.0.0",
                "storage_backend": os.environ.get("STORAGE_BACKEND", "s3" if os.environ.get("DOC_BUCKET_NAME") else "local"),
                "max_file_size_mb": MAX_FILE_SIZE_MB,
            })

        # Route 4: Supported Formats & Capabilities
        if clean_path == "/formats" and http_method == "GET":
            return build_response(200, {
                "supported_conversions": SUPPORTED_CONVERSIONS,
                "supported_inputs": list(SUPPORTED_CONVERSIONS.keys()),
                "goals": {
                    key: {
                        "description": GOAL_DESCRIPTIONS.get(key, ""),
                        "preferences": GOAL_PREFERENCES.get(key, []),
                    }
                    for key in GOAL_PREFERENCES
                },
                "max_file_size_mb": MAX_FILE_SIZE_MB,
            })

        # Route 5: Format Recommendation
        if clean_path == "/recommend" and http_method == "POST":
            body = json.loads(event.get("body") or "{}")
            source_format = body.get("source_format", "")
            goal = body.get("goal")
            if not source_format:
                return build_response(400, {"error": "Missing required field: 'source_format'"})
            recommendation = recommend_format(source_format, goal=goal)
            return build_response(200, recommendation)

        # Route 6: Upload URL Request (for large/presigned S3 uploads)
        if clean_path == "/upload-url" and http_method == "POST":
            body = json.loads(event.get("body") or "{}")
            raw_filename = body.get("filename", "document")
            clean_name = sanitize_filename(raw_filename)
            job_id = str(uuid.uuid4())
            key = f"uploads/{job_id}/{clean_name}"

            storage = get_storage_provider()
            upload_meta = storage.get_upload_url(key)
            upload_meta["job_id"] = job_id
            return build_response(200, upload_meta)

        # Route 7: Perform Conversion
        if clean_path == "/convert" and http_method == "POST":
            return _handle_convert(event)

        # Route 8: Job Status & Validation Report Retrieval
        if clean_path.startswith("/jobs/") and http_method == "GET":
            job_id = clean_path.replace("/jobs/", "").strip()
            storage = get_storage_provider()
            job_meta = storage.get_job_metadata(job_id)
            if not job_meta:
                return build_response(404, {"error": f"Job '{job_id}' not found."})
            return build_response(200, job_meta)

        # Route 9: Direct Download by Key
        if clean_path in ("/download", "/download/") and http_method == "GET":
            params = event.get("queryStringParameters") or {}
            key = params.get("key")
            if not key:
                return build_response(400, {"error": "Missing 'key' query parameter."})
            storage = get_storage_provider()
            file_bytes = storage.get_bytes(key)
            b64_data = base64.b64encode(file_bytes).decode("ascii")
            ext = key.split(".")[-1].lower() if "." in key else "bin"
            out_filename = sanitize_filename(os.path.basename(key))
            return build_response(
                200,
                b64_data,
                content_type="application/octet-stream",
                is_base64=True,
                extra_headers={
                    "Content-Disposition": f'attachment; filename="{out_filename}"',
                },
            )

        return build_response(404, {"error": f"Route not found: {http_method} {clean_path}"})

    except json.JSONDecodeError:
        return build_response(400, {"error": "Invalid JSON body provided."})
    except Exception as e:
        logger.exception("Internal error processing request: %s", str(e))
        return build_response(500, {"error": "An internal server error occurred. Please try again."})


def _handle_convert(event: Dict[str, Any]) -> Dict[str, Any]:
    """Execute document conversion workflow, quality validation, and storage."""
    body = json.loads(event.get("body") or "{}")

    filename = sanitize_filename(body.get("filename", "document.txt"))
    target_format = normalize_format(body.get("target_format", ""))
    goal = body.get("goal")

    # Detect source format from explicit field or filename
    source_format = normalize_format(body.get("source_format", ""))
    if not source_format and "." in filename:
        source_format = normalize_format(filename.rsplit(".", 1)[-1])

    if not source_format or not target_format:
        return build_response(400, {
            "error": "Both 'source_format' and 'target_format' must be specified.",
            "received": {"source_format": source_format, "target_format": target_format},
        })

    if not is_conversion_supported(source_format, target_format):
        return build_response(400, {
            "error": f"Conversion from '{source_format.upper()}' to '{target_format.upper()}' is not supported.",
            "supported_targets_for_input": list(SUPPORTED_CONVERSIONS.get(source_format, [])),
        })

    storage = get_storage_provider()
    job_id = str(uuid.uuid4())

    # Obtain input document bytes (either direct base64 or storage key)
    input_bytes: bytes
    if "content_base64" in body:
        try:
            input_bytes = base64.b64decode(body["content_base64"])
        except Exception:
            return build_response(400, {"error": "Invalid base64 payload in 'content_base64'."})
    elif "input_key" in body:
        input_key = body["input_key"]
        try:
            input_bytes = storage.get_bytes(input_key)
        except Exception as e:
            return build_response(404, {"error": f"Failed to retrieve input file from key '{input_key}': {str(e)}"})
    else:
        return build_response(400, {"error": "Payload must include either 'content_base64' or 'input_key'."})

    # Validate file size limits
    if len(input_bytes) > MAX_BYTES:
        return build_response(413, {
            "error": f"File size ({len(input_bytes) / 1024 / 1024:.2f} MB) exceeds maximum allowed ({MAX_FILE_SIZE_MB} MB).",
        })

    # Execute Conversion
    try:
        output_bytes, content_type = convert_document(
            input_data=input_bytes,
            source_format=source_format,
            target_format=target_format,
        )
    except ConversionError as e:
        return build_response(400, {"error": str(e)})
    except Exception as e:
        logger.exception("Conversion execution failure: %s", str(e))
        return build_response(500, {"error": f"Conversion processing error: {str(e)}"})

    # Execute Automatic Quality Validation
    validation_report = validate_conversion_quality(
        input_data=input_bytes,
        input_format=source_format,
        output_data=output_bytes,
        output_format=target_format,
    )

    # Persist input and output documents in storage
    base_name = filename.rsplit(".", 1)[0] if "." in filename else filename
    out_filename = f"{base_name}.{target_format}"
    input_key = f"documents/{job_id}/source.{source_format}"
    output_key = f"documents/{job_id}/{out_filename}"

    storage.save_bytes(input_key, input_bytes)
    storage.save_bytes(output_key, output_bytes, content_type=content_type)

    download_url = storage.get_download_url(output_key)

    # Assemble and persist job record
    job_record = {
        "job_id": job_id,
        "status": "COMPLETED",
        "filename": filename,
        "output_filename": out_filename,
        "source_format": source_format,
        "target_format": target_format,
        "input_bytes": len(input_bytes),
        "output_bytes": len(output_bytes),
        "download_url": download_url,
        "output_key": output_key,
        "validation": validation_report,
        "content_type": content_type,
    }

    # Include base64 output directly if file size is small (< 4MB) for immediate download convenience
    if len(output_bytes) <= 4 * 1024 * 1024:
        job_record["output_base64"] = base64.b64encode(output_bytes).decode("ascii")

    storage.save_job_metadata(job_id, job_record)

    return build_response(200, job_record)
