"""Unit tests for the Lambda handler and REST API routing."""

import json
import base64
import pytest
from conversion_app import app


@pytest.fixture
def make_event():
    """Helper to generate API Gateway mock events."""
    def _create(method="GET", path="/", body=None, query_params=None):
        return {
            "httpMethod": method,
            "path": path,
            "headers": {
                "Accept": "*/*",
                "Content-Type": "application/json",
            },
            "queryStringParameters": query_params or {},
            "body": json.dumps(body) if body is not None and not isinstance(body, str) else body,
        }
    return _create


def test_lambda_handler_root_html(make_event):
    event = make_event(method="GET", path="/")
    response = app.lambda_handler(event, None)

    assert response["statusCode"] == 200
    assert "text/html" in response["headers"]["Content-Type"]
    assert "Rapid Document Conversion" in response["body"]


def test_lambda_handler_health(make_event):
    event = make_event(method="GET", path="/health")
    response = app.lambda_handler(event, None)

    assert response["statusCode"] == 200
    data = json.loads(response["body"])
    assert data["status"] == "healthy"
    assert data["service"] == "Rapid Document Conversion"
    assert "storage_backend" in data


def test_lambda_handler_formats(make_event):
    event = make_event(method="GET", path="/formats")
    response = app.lambda_handler(event, None)

    assert response["statusCode"] == 200
    data = json.loads(response["body"])
    assert "supported_conversions" in data
    assert "txt" in data["supported_inputs"]
    assert "pdf" in data["supported_conversions"]["txt"]


def test_lambda_handler_recommend(make_event):
    event = make_event(
        method="POST",
        path="/recommend",
        body={"source_format": "txt", "goal": "share_print"},
    )
    response = app.lambda_handler(event, None)

    assert response["statusCode"] == 200
    data = json.loads(response["body"])
    assert data["recommended_format"] == "pdf"


def test_lambda_handler_convert_success(make_event):
    sample_text = "Testing API Gateway Lambda Handler conversion."
    b64_content = base64.b64encode(sample_text.encode("utf-8")).decode("ascii")

    event = make_event(
        method="POST",
        path="/convert",
        body={
            "filename": "test_document.txt",
            "source_format": "txt",
            "target_format": "pdf",
            "content_base64": b64_content,
            "goal": "share_print",
        },
    )

    response = app.lambda_handler(event, None)
    assert response["statusCode"] == 200

    data = json.loads(response["body"])
    assert data["status"] == "COMPLETED"
    assert data["output_filename"] == "test_document.pdf"
    assert data["validation"]["status"] in ("PASS", "WARNING")
    assert "output_base64" in data

    # Verify that the generated job metadata is accessible via GET /jobs/{id}
    job_id = data["job_id"]
    get_job_event = make_event(method="GET", path=f"/jobs/{job_id}")
    job_response = app.lambda_handler(get_job_event, None)
    assert job_response["statusCode"] == 200
    job_data = json.loads(job_response["body"])
    assert job_data["job_id"] == job_id


def test_lambda_handler_unsupported_conversion(make_event):
    event = make_event(
        method="POST",
        path="/convert",
        body={
            "filename": "document.pdf",
            "source_format": "pdf",
            "target_format": "docx",  # Unsupported direction
            "content_base64": base64.b64encode(b"sample").decode("ascii"),
        },
    )

    response = app.lambda_handler(event, None)
    assert response["statusCode"] == 400
    data = json.loads(response["body"])
    assert "not supported" in data["error"].lower()


def test_lambda_handler_cors_preflight(make_event):
    event = make_event(method="OPTIONS", path="/convert")
    response = app.lambda_handler(event, None)

    assert response["statusCode"] == 200
    assert response["headers"]["Access-Control-Allow-Origin"] == "*"
