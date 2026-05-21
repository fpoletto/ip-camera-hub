import socket
import sys

try:
    if_index = socket.if_nametoindex('en0')
    print(f"Interface en0 index: {if_index}")
except Exception as e:
    print(f"Failed to get en0 index: {e}")
    sys.exit(1)

# On macOS, IP_BOUND_IF is option 25 under IPPROTO_IP
IP_BOUND_IF = 25

print("\nTesting SSDP Multicast Socket...")
try:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, if_index)
    sock.settimeout(1.0)
    
    # We bind to 0.0.0.0 but forced to en0
    sock.bind(('0.0.0.0', 0))
    
    ssdp_request = (
        'M-SEARCH * HTTP/1.1\r\n'
        'HOST: 239.255.255.250:1900\r\n'
        'MAN: "ssdp:discover"\r\n'
        'MX: 2\r\n'
        'ST: ssdp:all\r\n'
        '\r\n'
    )
    
    print("Sending SSDP multicast request...")
    sock.sendto(ssdp_request.encode('utf-8'), ('239.255.255.250', 1900))
    print("Multicast request sent successfully!")
    sock.close()
except Exception as e:
    print(f"Multicast failed: {e}")

print("\nTesting SSDP Broadcast Socket...")
try:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, if_index)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.settimeout(1.0)
    sock.bind(('0.0.0.0', 0))
    
    print("Sending SSDP broadcast request to 192.168.3.255...")
    sock.sendto(ssdp_request.encode('utf-8'), ('192.168.3.255', 1900))
    print("Broadcast request sent successfully!")
    sock.close()
except Exception as e:
    print(f"Broadcast failed: {e}")
