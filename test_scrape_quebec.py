import requests
from bs4 import BeautifulSoup
import re

url = "https://www.rate-my-agent.com/Quebec-QC-Agent-Ratings"
headers = {'User-Agent': 'Mozilla/5.0'}
r = requests.get(url, headers=headers)
print(f"Status Code: {r.status_code}")
soup = BeautifulSoup(r.text, 'html.parser')

agents = soup.find_all('a', href=re.compile(r'-ratings-'))
print(f"Total -ratings- hrefs found: {len(agents)}")
for a in agents[:10]:
    print(f"Agent: {a.get_text(strip=True)}, Href: {a.get('href')}")
