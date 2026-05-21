import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
import re
import sys

targets = ["192.168.3.138", "192.168.3.139"]

def send_soap(url, action, payload):
    try:
        req = urllib.request.Request(
            url,
            data=payload.encode('utf-8'),
            headers={
                'Content-Type': 'application/soap+xml; charset=utf-8',
                'User-Agent': 'Antigravity-ONVIF-Client/1.0',
                'SOAPAction': action
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"  [SOAP ERROR] {url} -> {e}")
        if hasattr(e, 'read'):
            try:
                print("  [ERROR BODY]", e.read().decode('utf-8', errors='ignore')[:300])
            except Exception:
                pass
        return None

def extract_tag(xml, tag_name):
    # Regex matching tag content, ignoring namespaces
    pattern = rf'<(?:[^:]+:)?{tag_name}>(.*?)</(?:[^:]+:)?{tag_name}>'
    matches = re.findall(pattern, xml, re.DOTALL)
    return [m.strip() for m in matches]

def extract_attribute(xml, attr_name):
    # Regex matching attribute value (e.g., token="Profile_1")
    pattern = rf'\b{attr_name}="([^"]+)"'
    matches = re.findall(pattern, xml)
    return matches

def get_camera_streams(ip):
    print(f"\n==========================================")
    print(f"Extracting Stream Info for {ip}")
    print(f"==========================================")
    
    device_service_url = f"http://{ip}:8080/onvif/device_service"
    
    # 1. Get Capabilities (to find Media Service URL)
    print("1. Sending GetCapabilities...")
    capabilities_soap = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">'
        '<soap:Body>'
        '<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>'
        '</soap:Body>'
        '</soap:Envelope>'
    )
    cap_resp = send_soap(device_service_url, "http://www.onvif.org/ver10/device/wsdl/GetCapabilities", capabilities_soap)
    if not cap_resp:
        print("Failed to get capabilities. Trying default media URL...")
        media_service_url = f"http://{ip}:8080/onvif/media_service"
    else:
        # Extract Media XAddr
        xaddrs = re.findall(r'<tt:XAddr>(.*?)</tt:XAddr>', cap_resp)
        media_xaddrs = [x for x in xaddrs if 'media' in x.lower()]
        if media_xaddrs:
            media_service_url = media_xaddrs[0]
            # Replace IP in XAddr if it's returned as 127.0.0.1 or local loopback
            if "127.0.0.1" in media_service_url or "localhost" in media_service_url:
                media_service_url = media_service_url.replace("127.0.0.1", ip).replace("localhost", ip)
            print(f"Found Media Service URL: {media_service_url}")
        else:
            print("Media service not found in capabilities. Using default...")
            media_service_url = f"http://{ip}:8080/onvif/media_service"

    # 2. Get Profiles
    print("\n2. Sending GetProfiles to Media Service...")
    profiles_soap = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl">'
        '<soap:Body>'
        '<trt:GetProfiles />'
        '</soap:Body>'
        '</soap:Envelope>'
    )
    prof_resp = send_soap(media_service_url, "http://www.onvif.org/ver10/media/wsdl/GetProfiles", profiles_soap)
    if not prof_resp:
        print("Failed to get profiles from Media Service.")
        return
        
    # Extract profile tokens
    # Typically <trt:Profiles token="token_val"> or <Profiles token="token_val">
    profile_tokens = re.findall(r'\btoken="([^"]+)"', prof_resp)
    # Filter only unique tokens
    profile_tokens = list(set(profile_tokens))
    
    if not profile_tokens:
        print("No video profiles found.")
        return
        
    print(f"Found Video Profiles: {profile_tokens}")
    
    # 3. GetStreamUri for each profile
    print("\n3. Extracting RTSP Stream URIs...")
    for token in profile_tokens:
        stream_soap = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">'
            '<soap:Body>'
            '<trt:GetStreamUri>'
            '<trt:StreamSetup>'
            '<tt:Stream>RTP-Unicast</tt:Stream>'
            '<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>'
            '</trt:StreamSetup>'
            '<trt:ProfileToken>{token}</trt:ProfileToken>'
            '</trt:GetStreamUri>'
            '</soap:Body>'
            '</soap:Envelope>'
        ).format(token=token)
        
        stream_resp = send_soap(media_service_url, "http://www.onvif.org/ver10/media/wsdl/GetStreamUri", stream_soap)
        if stream_resp:
            uris = re.findall(r'<tt:Uri>(.*?)</tt:Uri>', stream_resp)
            if not uris:
                uris = re.findall(r'<Uri>(.*?)</Uri>', stream_resp)
            if uris:
                rtsp_url = uris[0]
                # Replace loopback IP in RTSP URL if needed
                if "127.0.0.1" in rtsp_url:
                    rtsp_url = rtsp_url.replace("127.0.0.1", ip)
                print(f"  [STREAM FOUND] Profile '{token}': {rtsp_url}")
            else:
                print(f"  No stream URI found for profile '{token}'")

if __name__ == "__main__":
    for target in targets:
        get_camera_streams(target)
