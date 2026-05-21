import socket
import struct
import time

# SSDP Multicast address and port
MCAST_GRP = '239.255.255.250'
MCAST_PORT = 1900
local_ip = '172.20.10.12'

# SSDP M-SEARCH Request message
ssdp_request = (
    'M-SEARCH * HTTP/1.1\r\n'
    'HOST: 239.255.255.250:1900\r\n'
    'MAN: "ssdp:discover"\r\n'
    'MX: 3\r\n'
    'ST: ssdp:all\r\n'
    '\r\n'
)

def ssdp_discover():
    print(f"Sending SSDP M-SEARCH to {MCAST_GRP}:{MCAST_PORT} binding to {local_ip}...")
    
    # Create a UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.settimeout(3.0)
    
    # Set the interface for multicast transmissions to our local Wi-Fi interface IP
    try:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(local_ip))
    except Exception as e:
        print(f"Failed to set multicast interface: {e}")
    
    # Bind to the local IP and a random port
    sock.bind((local_ip, 0))
    
    # Send the SSDP request
    sock.sendto(ssdp_request.encode('utf-8'), (MCAST_GRP, MCAST_PORT))
    
    # Collect responses
    start_time = time.time()
    responses = {}
    
    while time.time() - start_time < 4.0:
        try:
            data, addr = sock.recvfrom(4096)
            response_text = data.decode('utf-8', errors='ignore')
            if addr[0] not in responses:
                print(f"[FOUND DEVICE] {addr[0]}")
                print(response_text)
                print("-" * 50)
                responses[addr[0]] = response_text
        except socket.timeout:
            break
        except Exception as e:
            print(f"Error receiving: {e}")
            break
            
    sock.close()
    return responses

if __name__ == "__main__":
    ssdp_discover()
