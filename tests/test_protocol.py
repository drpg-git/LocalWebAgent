import pytest

from server.protocol import failure, parse_request, success


def test_request_protocol():
    request = parse_request({
        "request_id": "abc",
        "tool": "read_file",
        "args": {"path": "main.py"},
    })
    assert request.request_id == "abc"
    assert request.tool == "read_file"
    assert request.args["path"] == "main.py"


def test_invalid_request():
    with pytest.raises(ValueError, match="INVALID_REQUEST"):
        parse_request({"tool": "read_file"})


def test_success_protocol():
    result = success("abc", {"content": "x"})
    assert result == {
        "type": "tool_result",
        "request_id": "abc",
        "ok": True,
        "result": {"content": "x"},
    }


def test_failure_protocol():
    result = failure("abc", "FILE_NOT_FOUND", "missing")
    assert result["request_id"] == "abc"
    assert result["ok"] is False
    assert result["error"]["code"] == "FILE_NOT_FOUND"
