import urllib.request
import time

url = "http://localhost:5001/stream/15/main"
print(f"Testing connection to {url}...")
try:
    req = urllib.request.urlopen(url, timeout=5)
    print("Connection established!")
    print("Response headers:")
    print(req.headers)
    
    # Read a small chunk of the MJPEG feed
    chunk = req.read(4096)
    print(f"Successfully read {len(chunk)} bytes from the stream!")
    req.close()
except Exception as e:
    print(f"Error: {e}")
