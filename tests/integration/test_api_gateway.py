"""Integration tests against live AWS SAM deployment (when deployed)."""

import os
import boto3
import pytest
import requests


class TestApiGateway:

    @pytest.fixture()
    def api_gateway_url(self):
        """Get the API Gateway URL from CloudFormation Stack outputs."""
        stack_name = os.environ.get("AWS_SAM_STACK_NAME")

        if stack_name is None:
            pytest.skip("AWS_SAM_STACK_NAME not set, skipping live integration test.")

        client = boto3.client("cloudformation")

        try:
            response = client.describe_stacks(StackName=stack_name)
        except Exception as e:
            raise Exception(f'Cannot find stack "{stack_name}": {e}') from e

        stacks = response["Stacks"]
        stack_outputs = stacks[0]["Outputs"]
        api_outputs = [output for output in stack_outputs if output["OutputKey"] == "WebInterfaceUrl"]

        if not api_outputs:
            raise KeyError(f"WebInterfaceUrl not found in stack {stack_name}")

        url = api_outputs[0]["OutputValue"]
        return url.rstrip("/")

    def test_health_endpoint(self, api_gateway_url):
        """Verify health check endpoint returns healthy status."""
        response = requests.get(f"{api_gateway_url}/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "Rapid Document Conversion"

    def test_formats_endpoint(self, api_gateway_url):
        """Verify format capabilities endpoint returns conversion matrix."""
        response = requests.get(f"{api_gateway_url}/formats", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert "supported_conversions" in data
        assert "pdf" in data["supported_conversions"]["txt"]
