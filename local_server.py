"""Local Development Server for Rapid Document Conversion.

Runs the full web application and REST API locally using Python's standard library
without requiring Docker or AWS credentials.
"""

import os
import sys
import json
import base64
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Set local storage mode for offline testing
os.environ.setdefault("STORAGE_BACKEND", "local")
os.environ.setdefault("CORS_ALLOW_ORIGIN", "*")

from conversion_app.app import lambda_handler



class LocalApiHandler(BaseHTTPRequestHandler):
    """Bridges HTTP requests to the AWS Lambda proxy handler."""

    def do_OPTIONS(self):
        self._dispatch("OPTIONS")

    def do_HEAD(self):
        self._dispatch("HEAD")

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def _dispatch(self, method: str):
        parsed = urlparse(self.path)
        path = parsed.path
        query_params = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8", errors="replace") if content_length > 0 else ""

        # Construct API Gateway proxy event
        event = {
            "httpMethod": method,
            "path": path,
            "headers": {k: v for k, v in self.headers.items()},
            "queryStringParameters": query_params,
            "body": body,
            "isBase64Encoded": False,
        }

        response = lambda_handler(event, None)

        status_code = response.get("statusCode", 200)
        headers = response.get("headers", {})
        resp_body = response.get("body", "")
        is_b64 = response.get("isBase64Encoded", False)

        self.send_response(status_code)
        for hk, hv in headers.items():
            self.send_header(hk, hv)
        self.end_headers()

        if is_b64:
            self.wfile.write(base64.b64decode(resp_body))
        elif isinstance(resp_body, str):
            self.wfile.write(resp_body.encode("utf-8"))
        elif isinstance(resp_body, bytes):
            self.wfile.write(resp_body)


def run_local(port: int = 8000):
    server = HTTPServer(("127.0.0.1", port), LocalApiHandler)
    print(f"\n=======================================================")
    print(f" Rapid Document Conversion - Local Development Server")
    print(f" URL: http://127.0.0.1:{port}/")
    print(f" Storage Mode: Local filesystem (.local_storage/)")
    print(f" Quality Validation: Automatic magic-bytes, readability & fidelity checks")
    print(f" Format Recommender: Rule-based intelligent goal analyzer")
    print(f" Press Ctrl+C to stop.")
    print(f"=======================================================\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local development server.")
        server.server_close()


if __name__ == "__main__":
    port_arg = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    run_local(port=port_arg)
