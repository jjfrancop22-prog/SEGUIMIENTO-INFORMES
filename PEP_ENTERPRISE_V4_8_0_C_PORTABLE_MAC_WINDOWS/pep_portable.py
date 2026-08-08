#!/usr/bin/env python3
import argparse
import http.server
import json
import os
import signal
import socket
import socketserver
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / '.pep_portable_state.json'
HOST = '127.0.0.1'
START_PORT = 8080
END_PORT = 8090

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def port_free(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind((HOST, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def choose_port():
    for port in range(START_PORT, END_PORT + 1):
        if port_free(port):
            return port
    raise RuntimeError(f'No hay puertos libres entre {START_PORT} y {END_PORT}.')


def write_state(port):
    STATE_FILE.write_text(json.dumps({'pid': os.getpid(), 'port': port}), encoding='utf-8')


def remove_state():
    try:
        STATE_FILE.unlink()
    except FileNotFoundError:
        pass


def start_server():
    os.chdir(ROOT)
    port = choose_port()
    handler = http.server.SimpleHTTPRequestHandler
    with ReusableTCPServer((HOST, port), handler) as httpd:
        write_state(port)
        url = f'http://localhost:{port}/index.html?v=V480C_PORTABLE'
        print('')
        print('PEP Enterprise V4.8.0-C Portable')
        print(f'Servidor activo: {url}')
        print('Puede cerrar esta ventana SOLO si desea detener el ERP local.')
        print('')
        threading.Timer(0.8, lambda: webbrowser.open(url, new=2)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            remove_state()


def stop_server():
    if not STATE_FILE.exists():
        print('No se encontró una instancia portátil activa.')
        return 0
    try:
        state = json.loads(STATE_FILE.read_text(encoding='utf-8'))
        pid = int(state.get('pid', 0))
    except Exception:
        remove_state()
        print('El estado del servidor estaba dañado y fue limpiado.')
        return 0
    if pid <= 0:
        remove_state()
        return 0
    try:
        if os.name == 'nt':
            os.system(f'taskkill /PID {pid} /T /F >NUL 2>&1')
        else:
            os.kill(pid, signal.SIGTERM)
        time.sleep(0.3)
        print('PEP Enterprise local detenido.')
    except Exception as exc:
        print(f'No se pudo detener automáticamente: {exc}')
    finally:
        remove_state()
    return 0


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--stop', action='store_true')
    args = parser.parse_args()
    if args.stop:
        return stop_server()
    return start_server() or 0

if __name__ == '__main__':
    raise SystemExit(main())
