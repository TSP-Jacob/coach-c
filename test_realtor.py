import requests

url = "https://www.realtor.ca/"
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
}
try:
    r = requests.get(url, headers=headers, timeout=10)
    print("Realtor.ca status:", r.status_code)
except Exception as e:
    print("Error:", e)
