"""Storage abstraction supporting both Amazon S3 and Local filesystem.

Provides safe object keys, presigned URLs, and stateless job metadata
persistence without requiring external database dependencies.
"""

import os
import re
import json
import uuid
import time
from typing import Dict, Any, Optional, Tuple
import boto3
from botocore.exceptions import ClientError


def sanitize_filename(filename: str) -> str:
    """Sanitize user-provided filename to prevent directory traversal or script injection."""
    clean = re.sub(r"[^\w\.\-_]", "_", os.path.basename(filename))
    return clean[:100] if clean else "document"


class StorageProvider:
    """Base storage interface."""
    def save_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        raise NotImplementedError

    def get_bytes(self, key: str) -> bytes:
        raise NotImplementedError

    def get_download_url(self, key: str, expires_in: int = 3600) -> str:
        raise NotImplementedError

    def get_upload_url(self, key: str, expires_in: int = 900) -> Dict[str, Any]:
        raise NotImplementedError

    def save_job_metadata(self, job_id: str, metadata: Dict[str, Any]) -> None:
        raise NotImplementedError

    def get_job_metadata(self, job_id: str) -> Optional[Dict[str, Any]]:
        raise NotImplementedError


class S3StorageProvider(StorageProvider):
    """Amazon S3 storage backend with server-side encryption and presigned URLs."""

    def __init__(self, bucket_name: str, region_name: Optional[str] = None):
        self.bucket_name = bucket_name
        self.s3_client = boto3.client("s3", region_name=region_name)

    def save_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        self.s3_client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=data,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )
        return key

    def get_bytes(self, key: str) -> bytes:
        response = self.s3_client.get_object(Bucket=self.bucket_name, Key=key)
        return response["Body"].read()

    def get_download_url(self, key: str, expires_in: int = 3600) -> str:
        return self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket_name, "Key": key},
            ExpiresIn=expires_in,
        )

    def get_upload_url(self, key: str, expires_in: int = 900) -> Dict[str, Any]:
        presigned_post = self.s3_client.generate_presigned_post(
            Bucket=self.bucket_name,
            Key=key,
            ExpiresIn=expires_in,
            Conditions=[
                ["content-length-range", 1, 15 * 1024 * 1024],  # 15MB max
            ],
        )
        return {
            "method": "POST",
            "url": presigned_post["url"],
            "fields": presigned_post["fields"],
            "key": key,
        }

    def save_job_metadata(self, job_id: str, metadata: Dict[str, Any]) -> None:
        key = f"jobs/{job_id}/metadata.json"
        body = json.dumps(metadata, indent=2).encode("utf-8")
        self.save_bytes(key, body, content_type="application/json")

    def get_job_metadata(self, job_id: str) -> Optional[Dict[str, Any]]:
        key = f"jobs/{job_id}/metadata.json"
        try:
            data = self.get_bytes(key)
            return json.loads(data.decode("utf-8"))
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return None
            raise


class LocalStorageProvider(StorageProvider):
    """Local filesystem storage backend for development, testing, and offline modes."""

    def __init__(self, base_dir: Optional[str] = None):
        if not base_dir:
            base_dir = os.path.join(os.getcwd(), ".local_storage")
        self.base_dir = os.path.abspath(base_dir)
        os.makedirs(self.base_dir, exist_ok=True)

    def _resolve(self, key: str) -> str:
        # Prevent traversal
        clean_key = key.replace("\\", "/").strip("/")
        full_path = os.path.abspath(os.path.join(self.base_dir, clean_key))
        if not full_path.startswith(self.base_dir):
            raise ValueError("Directory traversal attempt detected")
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        return full_path

    def save_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        path = self._resolve(key)
        with open(path, "wb") as f:
            f.write(data)
        return key

    def get_bytes(self, key: str) -> bytes:
        path = self._resolve(key)
        if not os.path.isfile(path):
            raise FileNotFoundError(f"Key not found: {key}")
        with open(path, "rb") as f:
            return f.read()

    def get_download_url(self, key: str, expires_in: int = 3600) -> str:
        # In local mode, route through /download/{key} endpoint
        return f"/download?key={key}"

    def get_upload_url(self, key: str, expires_in: int = 900) -> Dict[str, Any]:
        return {
            "method": "DIRECT",
            "url": f"/upload?key={key}",
            "fields": {},
            "key": key,
        }

    def save_job_metadata(self, job_id: str, metadata: Dict[str, Any]) -> None:
        key = f"jobs/{job_id}/metadata.json"
        body = json.dumps(metadata, indent=2).encode("utf-8")
        self.save_bytes(key, body, content_type="application/json")

    def get_job_metadata(self, job_id: str) -> Optional[Dict[str, Any]]:
        key = f"jobs/{job_id}/metadata.json"
        try:
            data = self.get_bytes(key)
            return json.loads(data.decode("utf-8"))
        except FileNotFoundError:
            return None


def get_storage_provider() -> StorageProvider:
    """Factory creating the appropriate StorageProvider based on environment configuration."""
    backend = os.environ.get("STORAGE_BACKEND", "").lower().strip()
    bucket_name = os.environ.get("DOC_BUCKET_NAME", "").strip()

    if backend == "local" or not bucket_name:
        return LocalStorageProvider()

    return S3StorageProvider(bucket_name=bucket_name)
