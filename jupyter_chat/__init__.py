from jupyter_server.utils import url_path_join


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "jupyterlab-chat"}]


def _jupyter_server_extension_points():
    return [{"module": "jupyter_chat"}]


def _load_jupyter_server_extension(server_app):
    from .handlers import (
        ChatHandler,
        ChatHistoryHandler,
        ChatSessionHandler,
        ChatStreamHandler,
    )

    host_pattern = ".*$"
    base_url = server_app.web_app.settings["base_url"]

    handlers = [
        (url_path_join(base_url, "api", "chat", "message"), ChatHandler),
        (url_path_join(base_url, "api", "chat", "stream"), ChatStreamHandler),
        (url_path_join(base_url, "api", "chat", "history"), ChatHistoryHandler),
        (url_path_join(base_url, "api", "chat", "sessions"), ChatSessionHandler),
    ]
    server_app.web_app.add_handlers(host_pattern, handlers)
    server_app.log.info("jupyter_chat server extension loaded")
