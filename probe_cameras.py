import socket
import sys
import time

IP_BOUND_IF = 25

try:
    IF_INDEX = socket.if_nametoindex('en0')
    print(f"Using interface en0 (index {IF_INDEX}) to bypass VPN")
except Exception as e:
    print(f"Failed to get index of en0: {e}")
    sys.exit(1)

targets = {
    "192.168.4.6": {
        "name": "Dahua Camera",
        "ports": [80, 554, 37777, 8000, 8080]
    },
    "192.168.4.12": {
        "name": "Espressif Camera",
        "ports": [80, 554, 8000, 8080, 8899]
    }
}

def probe_port(ip, port):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, IF_INDEX)
        s.settimeout(2.0) # 2 seconds timeout
        s.bind(('0.0.0.0', 0))
        s.connect((ip, port))
        s.close()
        return True
    except Exception as e:
        return False

print("\n=== PROBING TARGET CAMERAS ===")
for ip, info in targets.items():
    print(f"\nProbing {info['name']} ({ip})...")
    any_open = False
    for port in info["ports"]:
        print(f" - Testing port {port}... ", end="", flush=True)
        if probe_port(ip, port):
            print("OPEN!")
            any_open = True
        else:
            print("closed/timeout")
    if not any_open:
        print(f"Could not reach {info['name']} ({ip}) on any standard ports via physical gateway.")
