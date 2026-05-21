import urllib.request
import urllib.error
import sys

targets = ["192.168.3.138", "192.168.3.139"]

def probe_http(ip):
    url = f"http://{ip}:8080/"
    print(f"\n--- Probing HTTP on {url} ---")
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Antigravity-IP-Cam-Scanner/1.0'}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            print("Response Status Code:", response.status)
            print("Headers:")
            for header, val in response.getheaders():
                print(f"  {header}: {val}")
                
            html = response.read().decode('utf-8', errors='ignore')
            print("\nResponse Body (first 1000 chars):")
            print(html[:1000])
            print("-" * 50)
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code} - {e.reason}")
        print("Headers:")
        for header, val in e.headers.items():
            print(f"  {header}: {val}")
    except urllib.error.URLError as e:
        print(f"URL Error: {e.reason}")
    except Exception as e:
        print(f"General Error: {e}")

if __name__ == "__main__":
    for target in targets:
        probe_http(target)
