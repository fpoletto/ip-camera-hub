import socket
import concurrent.futures
import time

targets = ["192.168.3.138", "192.168.3.139"]

def check_port(ip, port):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        s.connect((ip, port))
        s.close()
        return port, True
    except Exception:
        return port, False

def scan_host(ip):
    print(f"\nScanning all 65535 TCP ports on {ip}...")
    open_ports = []
    
    # We use a ThreadPoolExecutor with 300 workers for high-speed scanning
    with concurrent.futures.ThreadPoolExecutor(max_workers=300) as executor:
        futures = {executor.submit(check_port, ip, port): port for port in range(1, 65536)}
        
        for future in concurrent.futures.as_completed(futures):
            port, is_open = future.result()
            if is_open:
                print(f" - [PORT OPEN] {ip}:{port}")
                open_ports.append(port)
                
    return ip, sorted(open_ports)

if __name__ == "__main__":
    start = time.time()
    results = {}
    for target in targets:
        ip, ports = scan_host(target)
        results[ip] = ports
        
    print("\n==================================")
    print("      FULL PORT SCAN RESULTS      ")
    print("==================================")
    for ip, ports in results.items():
        print(f"Device {ip}: Open Ports -> {ports}")
    print(f"Scan completed in {time.time() - start:.2f} seconds.")
