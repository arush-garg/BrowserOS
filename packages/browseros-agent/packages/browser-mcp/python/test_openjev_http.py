"""HTTP lifecycle tests without loading model weights."""
from http.client import HTTPConnection
import json
import threading
import unittest
from unittest.mock import Mock, patch

import openjev_http as http


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.server = http.ThreadingHTTPServer(('127.0.0.1', 0), http.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method, body=None, headers=None):
        conn = HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            conn.request(method, '/health' if method == 'GET' else '/v1/systemone', body, headers or {})
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def test_health_does_not_load_model_or_reset_idle(self):
        with patch.object(http.svc, 'load') as load, patch.object(http, '_last_request', 1):
            self.assertEqual(self.request('GET')[0], 200)
            self.assertEqual(http._last_request, 1)
            load.assert_not_called()

    def test_malformed_length_and_json_return_400(self):
        self.assertEqual(self.request('POST', '{}', {'Content-Length': 'bad'})[0], 400)
        self.assertEqual(self.request('POST', '{')[0], 400)
        self.assertEqual(self.request('POST', '[]')[0], 400)

    def test_prediction_and_cleanup_are_serialized(self):
        def predict(*args):
            self.assertTrue(http._lock.locked())
            return {'answers': {}, 'usage': {}}

        def cleanup():
            self.assertTrue(http._lock.locked())

        with patch.object(http.svc, 'load') as load, patch.object(http.svc, 'predict', side_effect=predict), patch.object(http.svc, 'release_memory', side_effect=cleanup) as release:
            status, body = self.request('POST', json.dumps({
                'state': 'test', 'questions': {'q': {
                    'type': 'choice', 'instructions': 'choose', 'criteria': {'a': 'one', 'b': 'two'},
                }},
            }))
            self.assertEqual(status, 200)
            self.assertIn('answers', body)
            load.assert_called_once()
            release.assert_called_once()

    def test_reaper_does_not_unload_before_deadline(self):
        stop = Mock()
        stop.wait.side_effect = [False, True]
        with patch.object(http, '_last_request', 100), patch.object(http, '_idle_seconds', 30), patch.object(http.time, 'monotonic', return_value=129), patch.object(http.svc, 'unload') as unload:
            http._idle_reaper(stop)
            unload.assert_not_called()

    def test_reaper_unloads_at_deadline(self):
        stop = Mock()
        stop.wait.side_effect = [False, True]
        with patch.object(http, '_last_request', 100), patch.object(http, '_idle_seconds', 30), patch.object(http.time, 'monotonic', return_value=130), patch.object(http.svc, 'unload', return_value=True) as unload:
            http._idle_reaper(stop)
            unload.assert_called_once()


if __name__ == '__main__':
    unittest.main()
