import socket
import time
import uuid

# WS-Discovery Probe Message
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
).format(uuid_str=str(uuid.uuid4()))

def ws_discover():
    broadcast_ip = '172.20.10.15'
    print(f"Sending WS-Discovery probe to subnet broadcast {broadcast_ip}:3702 binding to 0.0.0.0...")
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.settimeout(3.0)
    
    # Bind to 0.0.0.0 and a random port
    sock.bind(('0.0.0.0', 0))
    
    # Send broadcast
    try:
        sock.sendto(ws_discovery_xml.encode('utf-8'), (broadcast_ip, 3702))
    except Exception as e:
        print(f"Send failed: {e}")
        sock.close()
        return {}
    
    responses = {}
    start_time = time.time()
    
    while time.time() - start_time < 4.0:
        try:
            data, addr = sock.recvfrom(4096)
            response_text = data.decode('utf-8', errors='ignore')
            if addr[0] not in responses:
                print(f"[FOUND ONVIF DEVICE] {addr[0]}")
                print(response_text[:1000])
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
    ws_discover()
