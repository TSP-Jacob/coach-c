import requests
from bs4 import BeautifulSoup
import re

url = "https://agentpronto.com/quebec/montreal"
headers = {'User-Agent': 'Mozilla/5.0'}
r = requests.get(url, headers=headers)
soup = BeautifulSoup(r.text, 'html.parser')

agents = soup.find_all('a', href=re.compile(r'^/agents/'))
if agents:
    print(agents[0].prettify())
