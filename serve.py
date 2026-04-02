#!/usr/bin/env python3
"""Simple HTTP server for local development."""

import http.server
import os

PORT = 8001

os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f"Serving at http://localhost:{PORT}")
http.server.HTTPServer(("", PORT), http.server.SimpleHTTPRequestHandler).serve_forever()
