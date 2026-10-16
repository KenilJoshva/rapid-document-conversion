"""Unit tests for intelligent format recommendation and matrix engine."""

from conversion_app.recommender import (
    normalize_format,
    is_conversion_supported,
    get_supported_targets,
    recommend_format,
)


def test_normalize_format():
    assert normalize_format(".PDF") == "pdf"
    assert normalize_format("  JPEG ") == "jpg"
    assert normalize_format("DOCX") == "docx"
    assert normalize_format("") == ""


def test_is_conversion_supported():
    assert is_conversion_supported("txt", "pdf") is True
    assert is_conversion_supported("md", "docx") is True
    assert is_conversion_supported("docx", "html") is True
    assert is_conversion_supported("png", "webp") is True
    # Unsupported
    assert is_conversion_supported("pdf", "docx") is False
    assert is_conversion_supported("exe", "pdf") is False


def test_recommend_format_by_goal():
    # TXT with share_print goal should recommend PDF
    rec = recommend_format("txt", goal="share_print")
    assert rec["recommended_format"] == "pdf"
    assert "pdf" in rec["supported_targets"]
    assert rec["confidence"] == "high"

    # TXT with editing goal should recommend DOCX or MD
    rec_edit = recommend_format("txt", goal="editing")
    assert rec_edit["recommended_format"] in ("docx", "md")

    # PDF with editing goal should recommend TXT or MD
    rec_pdf = recommend_format("pdf", goal="editing")
    assert rec_pdf["recommended_format"] in ("txt", "md")

    # PNG with web publishing goal should recommend WebP
    rec_img = recommend_format("png", goal="web_publishing")
    assert rec_img["recommended_format"] == "webp"


def test_recommend_format_unsupported_input():
    rec = recommend_format("xyz_unsupported")
    assert rec["recommended_format"] is None
    assert rec["confidence"] == "none"
    assert len(rec["supported_targets"]) == 0
