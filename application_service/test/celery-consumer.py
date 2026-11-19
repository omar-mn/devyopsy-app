"""Interoperability test only. Not a component of the Application Service."""

import json
import sys
import threading

import celery
import kombu
from celery import Celery
from celery.worker.request import Request
from fakeredis import TcpFakeServer


def main():
    server = TcpFakeServer(("127.0.0.1", 0), server_type="redis")
    server.daemon_threads = True
    server.block_on_close = False
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    print(json.dumps({"port": port}), flush=True)

    try:
        expected = json.loads(sys.stdin.readline())
        app = Celery("node-contract-check", broker=f"redis://127.0.0.1:{port}/0")
        app.conf.update(
            accept_content=["json"],
            task_serializer="json",
            task_protocol=2,
            task_ignore_result=True,
            broker_transport_options={"global_keyprefix": "contract-test:"},
        )
        executed = []

        @app.task(name="builds.start_build", ignore_result=True)
        def start_build(payload):
            assert payload == expected
            executed.append(payload)

        app.finalize()
        with app.connection_for_read() as connection:
            with connection.SimpleQueue("build") as queue:
                message = queue.get(timeout=10)
                print("Kombu received the Node-published message.", file=sys.stderr, flush=True)
                assert message.headers["task"] == "builds.start_build"
                assert message.headers["id"] == expected["request_id"]
                assert message.payload[0] == [expected]
                assert message.payload[1] == {}

                # Anonymous-exchange routing must also survive Kombu's redelivery path.
                message.reject(requeue=True)
                restored = queue.get(timeout=10)
                print("Kombu restored and redelivered the message.", file=sys.stderr, flush=True)
                invocation = Request(restored, app=app)
                assert invocation.id == expected["request_id"]
                assert invocation.ignore_result is True
                invocation.execute()
                assert executed == [expected]
                restored.ack()

        print(json.dumps({
            "result": "passed",
            "celery": celery.__version__,
            "kombu": kombu.__version__,
            "checks": ["Redis TCP publication", "Kombu decoding", "redelivery", "Celery task execution"],
        }), flush=True)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


if __name__ == "__main__":
    main()
