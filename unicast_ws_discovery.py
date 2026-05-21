import socket
import time
import uuid
import concurrent.futures

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

subnet = "172.20.10"
ips = [f"{subnet}.{i}" for i in range(1, 15)]

def probe_ip(ip):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(0.8)
    
    xml_data = ws_discovery_xml.format(uuid_str=str(uuid.uuid4()))
    try:
        sock.sendto(xml_data.encode('utf-8'), (ip, 3702))
        data, addr = sock.recvfrom(4096)
        response_text = data.decode('utf-8', errors='ignore')
        return ip, response_text
    except socket.timeout:
        return ip, None
    except Exception as e:
        return ip, f"Error: {e}"
    finally:
        sock.close()

def scan():
    print("Scanning subnet 172.20.10.0/28 with unicast WS-Discovery (no bind)...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        results = executor.map(probe_ip, ips)
        for ip, res in results:
            if res and not res.startswith("Error"):
                print(f"[FOUND ONVIF DEVICE] {ip}")
                print(res[:500])
                print("-" * 50)
            elif res and res.startswith("Error"):
                print(f"{ip}: {res}")

if __name__ == "__main__":
    scan()
