import socket
import time
import uuid
import concurrent.futures
import subprocess
import re

SUBNET = "192.168.3"
IPS = [f"{SUBNET}.{i}" for i in range(1, 255)]
PORTS = [80, 443, 554, 8000, 8080, 8554, 8899, 37777]

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
    'MX: 2\r\n'
    'ST: ssdp:all\r\n'
    '\r\n'
)

def ping_ip(ip):
    try:
        # Pings once with 0.5s timeout
        res = subprocess.run(['ping', '-c', '1', '-t', '1', ip], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return ip, res.returncode == 0
    except Exception:
        return ip, False

def check_tcp_port(ip, port):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.8)
        s.connect((ip, port))
        s.close()
        return ip, port, True
    except Exception:
        return ip, port, False

def run_ssdp():
    print("Running SSDP Multicast discovery...")
    found = {}
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.settimeout(2.0)
        sock.sendto(ssdp_request.encode('utf-8'), ('239.255.255.250', 1900))
        start = time.time()
        while time.time() - start < 3.0:
            try:
                data, addr = sock.recvfrom(4096)
                if addr[0] not in found:
                    print(f" - [SSDP] Found active device: {addr[0]}")
                    found[addr[0]] = data.decode('utf-8', errors='ignore')
            except socket.timeout:
                break
        sock.close()
    except Exception as e:
        print(f"SSDP failed: {e}")
    return found

def run_onvif():
    print("Running ONVIF WS-Discovery...")
    found = {}
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2.0)
        xml = ws_discovery_xml.format(uuid_str=str(uuid.uuid4()))
        sock.sendto(xml.encode('utf-8'), ('239.255.255.250', 3702))
        start = time.time()
        while time.time() - start < 3.0:
            try:
                data, addr = sock.recvfrom(4096)
                if addr[0] not in found:
                    print(f" - [ONVIF] Found active camera: {addr[0]}")
                    found[addr[0]] = data.decode('utf-8', errors='ignore')
            except socket.timeout:
                break
        sock.close()
    except Exception as e:
        print(f"ONVIF failed: {e}")
    return found

def main():
    print(f"=== Starting Scan on Subnet {SUBNET}.0/24 ===")
    
    # 1. SSDP
    ssdp_devs = run_ssdp()
    
    # 2. ONVIF
    onvif_devs = run_onvif()
    
    # 3. Ping Sweep
    print("Performing Ping Sweep...")
    active_ips = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=100) as executor:
        futures = {executor.submit(ping_ip, ip): ip for ip in IPS}
        for future in concurrent.futures.as_completed(futures):
            ip, is_alive = future.result()
            if is_alive:
                print(f" - [PING] {ip} is online")
                active_ips.append(ip)
                
    # 4. TCP scan of active hosts (and also sweep all hosts on port 80/554 just in case they ignore ping)
    print("Performing TCP Port Scan on active and common camera ports...")
    tcp_results = {}
    
    # Scan all hosts on ports 80 and 554
    sweep_targets = []
    for ip in IPS:
        sweep_targets.append((ip, 80))
        sweep_targets.append((ip, 554))
        sweep_targets.append((ip, 8000))
        sweep_targets.append((ip, 37777))
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=150) as executor:
        futures = [executor.submit(check_tcp_port, ip, port) for ip, port in sweep_targets]
        for future in concurrent.futures.as_completed(futures):
            ip, port, is_open = future.result()
            if is_open:
                print(f" - [TCP] {ip}:{port} is OPEN")
                if ip not in tcp_results:
                    tcp_results[ip] = []
                tcp_results[ip].append(port)
                
    # Print ARP table to find any extra MAC addresses
    print("\nReading local ARP cache...")
    try:
        arp_out = subprocess.check_output(['arp', '-a']).decode('utf-8', errors='ignore')
        print(arp_out)
    except Exception as e:
        print(f"Failed to read ARP cache: {e}")

    # Aggregated Summary
    print("\n" + "="*40)
    print("         DETAILED SCAN REPORT          ")
    print("="*40)
    
    all_found_ips = set(list(ssdp_devs.keys()) + list(onvif_devs.keys()) + active_ips + list(tcp_results.keys()))
    print(f"Total Unique active devices found: {len(all_found_ips)}")
    for ip in sorted(all_found_ips):
        print(f"\nIP: {ip}")
        if ip in ssdp_devs:
            print(" - Protocols: SSDP (UPnP)")
        if ip in onvif_devs:
            print(" - Protocols: ONVIF (WS-Discovery)")
            xml = onvif_devs[ip]
            for line in xml.split('\n'):
                if 'Address' in line or 'Types' in line or 'Scopes' in line or 'XAddrs' in line:
                    print(f"    {line.strip()[:150]}")
        if ip in tcp_results:
            print(f" - Open TCP Ports: {tcp_results[ip]}")
            
if __name__ == "__main__":
    main()
