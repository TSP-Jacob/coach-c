from googlesearch import search

for query in ["Vyncent Ledoux courtier immobilier", "Marty Waite courtier"]:
    print(f"\nQuery: {query}")
    try:
        results = search(query, num_results=5)
        for r in results:
            print(" ->", r)
    except Exception as e:
        print("Error:", e)
