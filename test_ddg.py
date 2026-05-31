from duckduckgo_search import DDGS

ddgs = DDGS()
results = ddgs.text("Martin Dumont real estate agent Montreal", max_results=5)
print(results)
