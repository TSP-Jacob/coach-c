import requests
from bs4 import BeautifulSoup
import re
import csv
import time

base_url = "https://agentpronto.com/quebec/montreal"
headers = {'User-Agent': 'Mozilla/5.0'}
agents = []

page = 1
while True:
    print(f"Fetching page {page}...")
    url = f"{base_url}?page={page}" if page > 1 else base_url
    r = requests.get(url, headers=headers)
    if r.status_code != 200:
        print(f"Failed to fetch page {page}, status code {r.status_code}")
        break
        
    soup = BeautifulSoup(r.text, 'html.parser')
    
    agent_links = soup.find_all('a', href=re.compile(r'^/agents/'))
    if not agent_links:
        print("No more agents found.")
        break
        
    page_agent_count = 0
    for link in agent_links:
        name_span = link.find('span', class_=re.compile(r'font-extrabold'))
        if name_span:
            name = name_span.get_text(strip=True)
            if name and name not in agents:
                agents.append(name)
                page_agent_count += 1
                
    print(f"Found {page_agent_count} new agents on page {page}.")
                
    # Check if there's a next page link
    next_page = soup.find('a', href=re.compile(rf'page={page+1}'))
    if not next_page:
        print("No next page link found.")
        break
        
    page += 1
    time.sleep(1) # Be polite

with open('agents.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(['Agent Name'])
    for agent in agents:
        writer.writerow([agent])
        
print(f"Total agents found: {len(agents)}")
