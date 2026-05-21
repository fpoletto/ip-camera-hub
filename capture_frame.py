import cv2
import os
import sys

# Force OpenCV/FFmpeg to use TCP for RTSP transport
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

def capture_frame(ip, stream_path, output_filename):
    rtsp_url = f"rtsp://{ip}/{stream_path}"
    print(f"\nConnecting to: {rtsp_url} via TCP...")
    
    # Initialize video capture
    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    
    if not cap.isOpened():
        print(f"[ERROR] Could not open video stream for {ip}.")
        return False
        
    # Read a frame
    print("Successfully connected! Reading frame...")
    ret, frame = cap.read()
    
    if ret:
        # Save frame to disk
        cv2.imwrite(output_filename, frame)
        print(f"[SUCCESS] Frame captured and saved as: {output_filename}")
        
        # Print resolution and metadata
        width = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
        height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        fps = cap.get(cv2.CAP_PROP_FPS)
        print(f"Video Resolution: {int(width)}x{int(height)} @ {fps} FPS")
        
        cap.release()
        return True
    else:
        print("[ERROR] Could not read frame from stream.")
        cap.release()
        return False

if __name__ == "__main__":
    ip_address = "192.168.3.138"
    stream = "rtsp_live0"
    output = "camera_frame.jpg"
    capture_frame(ip_address, stream, output)
