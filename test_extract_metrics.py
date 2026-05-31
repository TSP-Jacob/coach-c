import requests
from bs4 import BeautifulSoup
import re

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
}

def test_pronto():
    url = "https://agentpronto.com/quebec/montreal"
    r = requests.get(url, headers=headers)
    soup = BeautifulSoup(r.text, 'html.parser')
    for link in soup.find_all('a', href=re.compile(r'^/agents/')):
        name_span = link.find('span', class_=re.compile(r'font-extrabold'))
        if not name_span: continue
        name = name_span.get_text(strip=True)
        text = link.get_text(" ", strip=True)
        sales_match = re.search(r'(\d+)\s+recent sales', text)
        exp_match = re.search(r'(\d+)\s+years experience', text)
        rev_match = re.search(r'\((\d+)\)', text)
        sales = int(sales_match.group(1)) if sales_match else 0
        exp = int(exp_match.group(1)) if exp_match else 0
        rev = int(rev_match.group(1)) if rev_match else 0
        print(f"Pronto -> {name}: {sales} sales, {exp} years, {rev} revs")
        break

def test_rma():
    url = "https://www.rate-my-agent.com/Quebec-QC-Agent-Ratings"
    r = requests.get(url, headers=headers)
    soup = BeautifulSoup(r.text, 'html.parser')
    for a in soup.find_all('a', href=re.compile(r'-ratings-')):
        name = a.get_text(strip=True)
        if name and name != '...':
            # find parent container
            parent = a.find_parent('div', class_='row') or a.find_parent('div')
            text = parent.get_text(" ", strip=True) if parent else ""
            total_match = re.search(r'(\d+)\s+total', text)
            total = int(total_match.group(1)) if total_match else 0
            print(f"RMA -> {name}: {total} total reviews")
            break

test_pronto()
test_rma()
