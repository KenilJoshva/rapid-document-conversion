"""Unit tests for storage abstraction and local provider."""

import os
import shutil
import tempfile
import pytest

from conversion_app.storage import LocalStorageProvider, sanitize_filename


@pytest.fixture
def temp_storage():
    temp_dir = tempfile.mkdtemp()
    provider = LocalStorageProvider(base_dir=temp_dir)
    yield provider
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_sanitize_filename():
    assert sanitize_filename("../../../etc/passwd") == "passwd"
    assert sanitize_filename("..\\..\\windows\\system32\\cmd.exe") == "cmd.exe"
    assert sanitize_filename("my report (final) 2026.pdf") == "my_report__final__2026.pdf"


def test_local_storage_crud(temp_storage):
    key = "documents/test-job-123/file.txt"
    content = b"Sample document bytes"

    # Save
    saved_key = temp_storage.save_bytes(key, content, content_type="text/plain")
    assert saved_key == key

    # Retrieve
    retrieved = temp_storage.get_bytes(key)
    assert retrieved == content

    # Download URL format
    dl_url = temp_storage.get_download_url(key)
    assert key in dl_url


def test_local_storage_metadata(temp_storage):
    job_id = "job-456"
    meta = {
        "job_id": job_id,
        "status": "COMPLETED",
        "output_format": "pdf",
    }

    temp_storage.save_job_metadata(job_id, meta)
    loaded = temp_storage.get_job_metadata(job_id)

    assert loaded is not None
    assert loaded["job_id"] == job_id
    assert loaded["status"] == "COMPLETED"


def test_local_storage_prevents_directory_traversal(temp_storage):
    with pytest.raises(ValueError):
        temp_storage._resolve("../../sensitive_file.txt")
