import socket
import struct
import time
import uuid
import concurrent.futures
import sys

# macOS specific socket option to bind to interface index
IP_BOUND_IF = 25

try:
    IF_INDEX = socket.if_nametoindex('en0')
    print(f"Forcing all sockets to physical interface en0 (index {IF_INDEX})")
except Exception as e:
    print(f"Failed to get index of en0: {e}")
    sys.exit(1)

LOCAL_IP = "192.168.3.4"
SUBNET = "192.168.3"
IPS = [f"{SUBNET}.{i}" for i in range(1, 255)]
COMMON_PORTS = [80, 443, 554, 1935, 5000, 8000, 8080, 8554, 8899, 9000, 37777]

# WS-Discovery Template
ws_discovery_xml = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<Envelope xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:dn="http://www.onvif.org/ver10/network/wsdl" xmlns="http://www.w3.org/2003/05/soap-envelope">'
    '<Header>'
    '<MessageID xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">uuid:{uuid_str}</MessageID>'
    '<To xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">urn:schemas-xmlsoap-org:ws:2004:08:addressing:role:target</To>'
    '<Action xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2004/08/discovery/Probe</Action>'
    '</Header>'
    '<Body>'
    '<Probe xmlns="http://schemas.xmlsoap.org/ws/2004/08/discovery">'
    '<Types>tds:Device</Types>'
    '</Probe>'
    '</Body>'
    '</Envelope>'
)

# SSDP Request
ssdp_request = (
    'M-SEARCH * HTTP/1.1\r\n'
    'HOST: 239.255.255.250:1900\r\n'
    'MAN: "ssdp:discover"\r\n'
    'MX: 3\r\n'
    'ST: ssdp:all\r\n'
    '\r\n'
)

def run_ssdp_discovery():
    print("\n=== RUNNING SSDP DISCOVERY ===")
    responses = {}
    
    # 1. Multicast SSDP
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, IF_INDEX)
        sock.settimeout(2.5)
        sock.bind(('0.0.0.0', 0))
        
        print("Sending SSDP multicast to 239.255.255.250:1900 on en0...")
        sock.sendto(ssdp_request.encode('utf-8'), ('239.255.255.250', 1900))
        
        start = time.time()
        while time.time() - start < 3.0:
            try:
                data, addr = sock.recvfrom(4096)
                if addr[0] not in responses:
                    print(f"[SSDP Multicast] Found: {addr[0]}")
                    responses[addr[0]] = data.decode('utf-8', errors='ignore')
            except socket.timeout:
                break
        sock.close()
    except Exception as e:
        print(f"SSDP Multicast failed: {e}")

    # 2. Subnet Broadcast SSDP
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, IF_INDEX)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(2.5)
        sock.bind(('0.0.0.0', 0))
        
        print("Sending SSDP broadcast to 192.168.3.255:1900 on en0...")
        sock.sendto(ssdp_request.encode('utf-8'), ('192.168.3.255', 1900))
        
        start = time.time()
        while time.time() - start < 3.0:
            try:
                data, addr = sock.recvfrom(4096)
                if addr[0] not in responses:
                    print(f"[SSDP Broadcast] Found: {addr[0]}")
                    responses[addr[0]] = data.decode('utf-8', errors='ignore')
            except socket.timeout:
                break
        sock.close()
    except Exception as e:
        print(f"SSDP Broadcast failed: {e}")
        
    return responses

def run_ws_discovery():
    print("\n=== RUNNING ONVIF WS-DISCOVERY ===")
    responses = {}
    xml_data = ws_discovery_xml.format(uuid_str=str(uuid.uuid4()))
    
    # 1. Multicast WS-Discovery
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, IF_INDEX)
        sock.settimeout(2.5)
        sock.bind(('0.0.0.0', 0))
        
        print("Sending ONVIF multicast to 239.255.255.250:3702 on en0...")
        sock.sendto(xml_data.encode('utf-8'), ('239.255.255.250', 3702))
        
        start = time.time()
        while time.time() - start < 3.0:
            try:
                data, addr = sock.recvfrom(4096)
                if addr[0] not in responses:
                    print(f"[ONVIF Multicast] Found: {addr[0]}")
                    responses[addr[0]] = data.decode('utf-8', errors='ignore')
            except socket.timeout:
                break
        sock.close()
    except Exception as e:
        print(f"ONVIF Multicast failed: {e}")

    # 2. Subnet Broadcast WS-Discovery
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, IF_INDEX)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(2.5)
        sock.bind(('0.0.0.0', 0))
        
        print("Sending ONVIF broadcast to 192.168.3.255:3702 on en0...")
        sock.sendto(xml_data.encode('utf-8'), ('192.168.3.255', 3702))
        
        start = time.time()
        while time.time() - start < 3.0:
            try:
                data, addr = sock.recvfrom(4096)
                if addr[0] not in responses:
                    print(f"[ONVIF Broadcast] Found: {addr[0]}")
                    responses[addr[0]] = data.decode('utf-8', errors='ignore')
            except socket.timeout:
                break
        sock.close()
    except Exception as e:
        print(f"ONVIF Broadcast failed: {e}")
        
    return responses

def probe_unicast_ws_discovery(ip):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, IF_INDEX)
    sock.settimeout(0.8)
    try:
        sock.bind(('0.0.0.0', 0))
        xml_data = ws_discovery_xml.format(uuid_str=str(uuid.uuid4()))
        sock.sendto(xml_data.encode('utf-8'), (ip, 3702))
        data, addr = sock.recvfrom(4096)
        sock.close()
        return ip, data.decode('utf-8', errors='ignore')
    except Exception:
        sock.close()
        return ip, None

def run_unicast_ws_discovery():
    print(f"\n=== RUNNING UNICAST WS-DISCOVERY SWEEP ON {SUBNET}.0/24 ===")
    found = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=100) as executor:
        futures = {executor.submit(probe_unicast_ws_discovery, ip): ip for ip in IPS}
        for future in concurrent.futures.as_completed(futures):
            ip = futures[future]
            try:
                ip, res = future.result()
                if res:
                    print(f"[ONVIF Unicast Sweep] Found active ONVIF camera at: {ip}")
                    found[ip] = res
            except Exception as e:
                pass
    return found

def check_tcp_port(ip, port):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, IF_INDEX)
        s.settimeout(1.5) # generous timeout
        s.bind(('0.0.0.0', 0))
        s.connect((ip, port))
        s.close()
        return ip, port, True
    except Exception:
        return ip, port, False

def run_tcp_port_scan():
    print(f"\n=== RUNNING TCP PORT SCAN ON {SUBNET}.0/24 ===")
    print(f"Scanning {len(IPS)} hosts on ports: {COMMON_PORTS}...")
    found = {}
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=100) as executor:
        futures = []
        for ip in IPS:
            for port in COMMON_PORTS:
                futures.append(executor.submit(check_tcp_port, ip, port))
                
        for future in concurrent.futures.as_completed(futures):
            ip, port, open_status = future.result()
            if open_status:
                print(f"[TCP PORT OPEN] {ip}:{port}")
                if ip not in found:
                    found[ip] = []
                found[ip].append(port)
                
    return found

if __name__ == "__main__":
    print(f"Starting physical interface discovery on en0 from local IP {LOCAL_IP}...")
    
    # 1. Run SSDP
    ssdp_res = run_ssdp_discovery()
    
    # 2. Run WS-Discovery Broadcast/Multicast
    ws_res = run_ws_discovery()
    
    # 3. Run Unicast WS-Discovery Sweep
    unicast_ws_res = run_unicast_ws_discovery()
    
    # 4. Run TCP Port Scan
    tcp_res = run_tcp_port_scan()
    
    print("\n==================================")
    print("         SUMMARY OF FINDINGS       ")
    print("==================================")
    
    all_ips = set(list(ssdp_res.keys()) + list(ws_res.keys()) + list(unicast_ws_res.keys()) + list(tcp_res.keys()))
    print(f"Total unique IPs found with some activity: {len(all_ips)}")
    for ip in all_ips:
        print(f"\nDevice: {ip}")
        if ip in ssdp_res:
            print(" - Responded to SSDP")
        if ip in ws_res or ip in unicast_ws_res:
            print(" - Responded to ONVIF (WS-Discovery)")
            xml = ws_res.get(ip) or unicast_ws_res.get(ip)
            if xml:
                for line in xml.split('\n'):
                    if 'Address' in line or 'Types' in line or 'Scopes' in line or 'XAddrs' in line:
                        print(f"    {line.strip()[:150]}")
        if ip in tcp_res:
            print(f" - Open TCP Ports: {tcp_res[ip]}")
