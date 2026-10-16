"""Unit tests for automatic quality validation module."""

import io
from PIL import Image
from conversion_app.validator import (
    verify_file_signature,
    validate_conversion_quality,
    extract_text_sample,
)
from conversion_app.converter import _text_to_pdf


def test_verify_file_signatures():
    # PDF
    assert verify_file_signature(b"%PDF-1.4\n...", "pdf") is True
    assert verify_file_signature(b"NOT_A_PDF", "pdf") is False

    # DOCX
    assert verify_file_signature(b"PK\x03\x04\x14\x00...", "docx") is True
    assert verify_file_signature(b"%PDF-1.4", "docx") is False

    # PNG
    assert verify_file_signature(b"\x89PNG\r\n\x1a\n\x00...", "png") is True

    # JPEG
    assert verify_file_signature(b"\xff\xd8\xff\xe0...", "jpg") is True

    # Plain Text
    assert verify_file_signature(b"Hello world, valid utf-8 string.", "txt") is True
    assert verify_file_signature(b"", "txt") is False


def test_validate_conversion_quality_pass():
    input_text = "Quality assurance validation test text."
    input_bytes = input_text.encode("utf-8")
    output_pdf = _text_to_pdf(input_text)

    report = validate_conversion_quality(
        input_data=input_bytes,
        input_format="txt",
        output_data=output_pdf,
        output_format="pdf",
    )

    assert report["status"] in ("PASS", "WARNING")
    assert report["metrics"]["output_bytes"] > 0
    assert report["metrics"]["page_count"] >= 1
    assert any(c["name"] == "File Signature / Magic Bytes" and c["status"] == "PASS" for c in report["checks"])
    assert any(c["name"] == "Format Readability" and c["status"] == "PASS" for c in report["checks"])


def test_validate_conversion_quality_fail_on_empty():
    report = validate_conversion_quality(
        input_data=b"input content",
        input_format="txt",
        output_data=b"",
        output_format="pdf",
    )

    assert report["status"] == "FAIL"
    assert any(c["name"] == "File Size Non-Zero" and c["status"] == "FAIL" for c in report["checks"])


def test_validate_conversion_quality_corrupted_signature():
    # Provide corrupted data claiming to be PDF
    corrupt_data = b"This is plainly corrupted data that is not a valid PDF file."

    report = validate_conversion_quality(
        input_data=b"some source",
        input_format="txt",
        output_data=corrupt_data,
        output_format="pdf",
    )

    assert report["status"] == "FAIL"
    assert any(c["name"] == "File Signature / Magic Bytes" and c["status"] == "FAIL" for c in report["checks"])
    assert len(report["issues"]) > 0
    issue_entry = report["issues"][0]
    assert "issue" in issue_entry
    assert "recommendation" in issue_entry
    assert "check" in issue_entry

