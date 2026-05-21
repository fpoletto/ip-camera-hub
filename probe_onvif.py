import urllib.request
import urllib.error
import sys

targets = ["192.168.3.138", "192.168.3.139"]

soap_request = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">'
    '<soap:Body>'
    '<tds:GetDeviceInformation />'
    '</soap:Body>'
    '</soap:Envelope>'
)

def query_onvif_info(ip):
    # ONVIF device service URL can be /onvif/device_service or just /
    endpoints = [f"http://{ip}:8080/onvif/device_service", f"http://{ip}:8080/"]
    
    print(f"\n==========================================")
    print(f"Querying ONVIF Device Info for {ip}")
    print(f"==========================================")
    
    for url in endpoints:
        print(f"Trying endpoint: {url}...")
        try:
            req = urllib.request.Request(
                url,
                data=soap_request.encode('utf-8'),
                headers={
                    'Content-Type': 'application/soap+xml; charset=utf-8',
                    'User-Agent': 'Antigravity-ONVIF-Client/1.0'
                },
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                xml_response = response.read().decode('utf-8', errors='ignore')
                print(f"[SUCCESS] Reply from {url}!")
                print("XML Response:")
                print(xml_response)
                
                # Parse out interesting tags manually using regex (simple and robust)
                import re
                manufacturer = re.findall(r'<tds:Manufacturer>(.*?)</tds:Manufacturer>', xml_response)
                model = re.findall(r'<tds:Model>(.*?)</tds:Model>', xml_response)
                fw = re.findall(r'<tds:FirmwareVersion>(.*?)</tds:FirmwareVersion>', xml_response)
                serial = re.findall(r'<tds:SerialNumber>(.*?)</tds:SerialNumber>', xml_response)
                
                if not manufacturer:
                    manufacturer = re.findall(r'<Manufacturer>(.*?)</Manufacturer>', xml_response)
                if not model:
                    model = re.findall(r'<Model>(.*?)</Model>', xml_response)
                if not fw:
                    fw = re.findall(r'<FirmwareVersion>(.*?)</FirmwareVersion>', xml_response)
                if not serial:
                    serial = re.findall(r'<SerialNumber>(.*?)</SerialNumber>', xml_response)
                    
                print("\n--- CAMERA IDENTIFICATION DETAILS ---")
                print(f"Manufacturer : {manufacturer[0] if manufacturer else 'Unknown'}")
                print(f"Model        : {model[0] if model else 'Unknown'}")
                print(f"Firmware     : {fw[0] if fw else 'Unknown'}")
                print(f"Serial Number: {serial[0] if serial else 'Unknown'}")
                print("--------------------------------------")
                return True
                
        except urllib.error.HTTPError as e:
            print(f"HTTP Error: {e.code} - {e.reason}")
            try:
                err_body = e.read().decode('utf-8', errors='ignore')
                print("Error XML details:")
                print(err_body[:500])
            except Exception:
                pass
        except urllib.error.URLError as e:
            print(f"URL Error: {e.reason}")
        except Exception as e:
            print(f"General Error: {e}")
            
    return False

if __name__ == "__main__":
    for target in targets:
        query_onvif_info(target)
