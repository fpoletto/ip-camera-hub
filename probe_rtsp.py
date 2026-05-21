import socket
import sys

def probe_rtsp(ip):
    print(f"\n--- Probing RTSP on {ip}:554 ---")
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3.0)
        s.connect((ip, 554))
        
        # Standard RTSP OPTIONS request
        req = (
            "OPTIONS rtsp://{ip}:554 RTSP/1.0\r\n"
            "CSeq: 1\r\n"
            "User-Agent: Antigravity-IP-Cam-Scanner/1.0\r\n"
            "\r\n"
        ).format(ip=ip)
        
        s.sendall(req.encode('utf-8'))
        response = s.recv(4096)
        s.close()
        
        resp_text = response.decode('utf-8', errors='ignore')
        print("Raw RTSP Response:")
        print(resp_text)
        
        # Look for Server header
        for line in resp_text.split('\r\n'):
            if line.lower().startswith('server:'):
                print(f"[IDENTIFICATION] Server header found: {line}")
            if line.lower().startswith('public:'):
                print(f"[METHODS] Supported methods: {line}")
                
    except Exception as e:
        print(f"Error probing RTSP on {ip}: {e}")

if __name__ == "__main__":
    probe_rtsp("192.168.3.138")
    probe_rtsp("192.168.3.139")
