from pdfminer.high_level import extract_text

try:
    text = extract_text('/Users/fabio.fph/aparelhos.pdf')
    print("PDF Text Extracted Successfully!")
    print(text[:5000]) # print first 5000 chars
    with open('aparelhos_text.txt', 'w') as f:
        f.write(text)
except Exception as e:
    print(f"Error reading PDF: {e}")
