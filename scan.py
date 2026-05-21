import socket
import concurrent.futures

# Subnet to scan
subnet = "192.168.3"
ips = [f"{subnet}.{i}" for i in range(1, 255)]
local_ip = "192.168.3.4"

# Ports to scan
ports = [80, 443, 554, 1935, 8000, 8080, 8554, 8899, 37777]

def check_port(ip, port):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.4)
        s.bind((local_ip, 0))
        s.connect((ip, port))
        s.close()
        return (ip, port, True)
    except Exception as e:
        return (ip, port, False)

def scan_network():
    print(f"Scanning subnet {subnet}.0/24 with local bind to {local_ip}...")
    found_services = []
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=100) as executor:
        futures = []
        for ip in ips:
            for port in ports:
                futures.append(executor.submit(check_port, ip, port))
        
        for future in concurrent.futures.as_completed(futures):
            ip, port, open_status = future.result()
            if open_status:
                print(f"[FOUND] {ip}:{port} is OPEN")
                found_services.append((ip, port))
                
    return found_services

if __name__ == "__main__":
    scan_network()
