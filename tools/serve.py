import http.server, socketserver, sys, functools, threading
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.glb': 'model/gltf-binary'}
    def log_message(self, *a): pass
class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True; allow_reuse_address = True
def start(root, port=8123):
    s = S(('127.0.0.1', port), functools.partial(H, directory=root))
    threading.Thread(target=s.serve_forever, daemon=True).start(); return s
if __name__ == '__main__':
    start(sys.argv[2] if len(sys.argv) > 2 else '.', int(sys.argv[1]) if len(sys.argv) > 1 else 8123)
    threading.Event().wait()
