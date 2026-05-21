import socket
import sys

def test_rtsp_describe(ip, path):
    print(f"\n--- RTSP DESCRIBE on {ip} for {path} ---")
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3.0)
        s.connect((ip, 554))
        
        # We send a standard DESCRIBE request
        req = (
            "DESCRIBE rtsp://{ip}/{path} RTSP/1.0\r\n"
            "CSeq: 2\r\n"
            "Accept: application/sdp\r\n"
            "User-Agent: Antigravity-Tester/1.0\r\n"
            "\r\n"
        ).format(ip=ip, path=path)
        
        s.sendall(req.encode('utf-8'))
        response = s.recv(4096)
        s.close()
        
        resp_text = response.decode('utf-8', errors='ignore')
        print("Response headers:")
        print(resp_text)
        
    except Exception as e:
        print(f"Error connecting: {e}")

if __name__ == "__main__":
    test_rtsp_describe("192.168.3.138", "rtsp_live0")
