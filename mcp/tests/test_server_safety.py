"""Production-session and stdio regressions; no real account or network needed."""
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from ynufe_campus_mcp.server import SessionExpiredError, YnufeSession, build_tools, run_stdio


def response(html, url='https://xjwis.ynufe.edu.cn/jsxsd/kscj/cjcx_list'):
    return Mock(text=html, url=url, apparent_encoding='utf-8')


class ServerSafetyTests(unittest.TestCase):
    def test_expired_grades_are_not_successful_empty_data(self):
        for html in ('<form><input name="userAccount"><input name="userPassword"></form>', '非法访问', '请重新登录'):
            with self.subTest(html=html):
                session = YnufeSession()
                session.logged_in = True
                session.s.get = Mock(return_value=response(html))
                with self.assertRaises(SessionExpiredError):
                    session.fetch_grades()
                self.assertFalse(session.logged_in)

    def test_expired_post_and_redirect_are_rejected(self):
        session = YnufeSession()
        session.logged_in = True
        session.s.post = Mock(return_value=response('login', 'https://xjwis.ynufe.edu.cn/jsxsd/xk/login.jsp'))
        with self.assertRaises(SessionExpiredError):
            session._post('/jsxsd/example', {})

    def test_expired_flag_does_not_prevent_relogin(self):
        session = YnufeSession()
        session.logged_in = True
        session.s.get = Mock(return_value=response('<input id="userAccount">'))
        session.login_with_ocr = Mock(return_value={'ok': True})
        login = next(tool['handler'] for tool in build_tools(lambda: session) if 'login' in tool['name'])
        self.assertEqual(login(user='dummy', password='dummy'), {'ok': True})
        session.login_with_ocr.assert_called_once()

    def test_valid_session_is_kept(self):
        session = YnufeSession()
        session.logged_in = True
        session.s.get = Mock(return_value=response('<div class="middletopdwxxcont">valid profile</div>'))
        session.login_with_ocr = Mock()
        login = next(tool['handler'] for tool in build_tools(lambda: session) if 'login' in tool['name'])
        self.assertTrue(login()['already_logged_in'])
        session.login_with_ocr.assert_not_called()

    def test_malformed_requests_do_not_kill_stdio(self):
        invalid = [[], None, 42, 'text', {},
                   {'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call', 'params': None},
                   {'jsonrpc': '2.0', 'id': 5, 'method': 'tools/call', 'params': {'arguments': []}}]
        requests = invalid + [{'jsonrpc': '2.0', 'id': 99, 'method': 'ping'}]
        source = io.StringIO('\n'.join(json.dumps(item) for item in requests))
        output = io.StringIO()
        with patch('sys.stdin', source), patch('sys.stdout', output):
            run_stdio(YnufeSession)
        results = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(results), len(requests))
        self.assertTrue(all('error' in item for item in results[:-1]))
        self.assertEqual(results[-1], {'jsonrpc': '2.0', 'id': 99, 'result': {}})


if __name__ == '__main__':
    unittest.main()
