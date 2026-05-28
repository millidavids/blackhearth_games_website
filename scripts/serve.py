#!/usr/bin/env python3
"""Simple HTTP server for local development.

Always serves from the project root (one level up from scripts/), regardless
of which directory the user invokes the script from.
"""

import http.server
import os

PORT = 8001

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(PROJECT_ROOT)
print(f"Serving {PROJECT_ROOT} at http://localhost:{PORT}")
http.server.HTTPServer(("", PORT), http.server.SimpleHTTPRequestHandler).serve_forever()
