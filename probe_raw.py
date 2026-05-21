import socket
import time
import sys

targets = ["192.168.3.138", "192.168.3.139"]

def probe_raw_tcp(ip):
    print(f"\n--- Testing Raw TCP on {ip}:8080 ---")
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3.0)
        s.connect((ip, 8080))
        
        # Write nothing, just wait a bit to see if there's a banner
        s.setblocking(False)
        time_start = time.time()
        banner = b""
        while time.time() - time_start < 2.0:
            try:
                data = s.recv(1024)
                if data:
                    banner += data
                else:
                    break
            except BlockingIOError:
                time.sleep(0.1)
                
        if banner:
            print("Received initial banner without sending anything:")
            print(banner.decode('utf-8', errors='ignore'))
            s.close()
            return
            
        # Send HTTP GET
        s.setblocking(True)
        print("Sending HTTP GET / request...")
        s.sendall(b"GET / HTTP/1.1\r\nHost: " + ip.encode() + b"\r\n\r\n")
        
        try:
            response = s.recv(4096)
            print("HTTP response received:")
            print(response.decode('utf-8', errors='ignore')[:1000])
        except socket.timeout:
            print("HTTP request timed out waiting for response.")
            
        s.close()
    except Exception as e:
        print(f"Raw TCP failed: {e}")

def probe_rtsp_on_8080(ip):
    print(f"\n--- Testing RTSP on {ip}:8080 ---")
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3.0)
        s.connect((ip, 8080))
        
        req = (
            "OPTIONS rtsp://{ip}:8080 RTSP/1.0\r\n"
            "CSeq: 1\r\n"
            "\r\n"
        ).format(ip=ip)
        
        s.sendall(req.encode('utf-8'))
        response = s.recv(4096)
        s.close()
        print("RTSP response received:")
        print(response.decode('utf-8', errors='ignore')[:1000])
    except Exception as e:
        print(f"RTSP probe failed: {e}")

if __name__ == "__main__":
    for target in targets:
        probe_raw_tcp(target)
        probe_rtsp_on_8080(target)
