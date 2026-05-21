import urllib.request
import re

ip = "192.168.3.138"
device_service_url = f"http://{ip}:8080/onvif/device_service"

capabilities_soap = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">'
    '<soap:Body>'
    '<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>'
    '</soap:Body>'
    '</soap:Envelope>'
)

try:
    req = urllib.request.Request(
        device_service_url,
        data=capabilities_soap.encode('utf-8'),
        headers={
            'Content-Type': 'application/soap+xml; charset=utf-8',
            'User-Agent': 'ONVIF-Probe/1.0',
            'SOAPAction': 'http://www.onvif.org/ver10/device/wsdl/GetCapabilities'
        },
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        resp_text = response.read().decode('utf-8', errors='ignore')
        print("--- ONVIF XADDRS FOUND ---")
        xaddrs = re.findall(r'<tt:XAddr>(.*?)</tt:XAddr>', resp_text)
        if not xaddrs:
            xaddrs = re.findall(r'<XAddr>(.*?)</XAddr>', resp_text)
        for xaddr in xaddrs:
            print(xaddr)
        print("--------------------------")
except Exception as e:
    print("Error:", e)
