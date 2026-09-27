How to use the demo fixture
===========================

A small synthetic codebase is included in `demo-fixtures/cobol-java-demo/`
to let you test the tool without needing a real legacy repo.

It contains:
  - CustomerService.java   — deep nesting, @Deprecated, Thread.sleep, System.exit, no tests
  - Customer.java          — plain bean
  - CUSTINQY.cbl           — COBOL with GO TO, EXEC SQL, hardcoded IP/path literals
  - CUSTCOPY.cbl           — copybook

Steps
-----
1. Zip the folder:

   Windows (PowerShell):
     Compress-Archive -Path demo-fixtures/cobol-java-demo/* -DestinationPath demo.zip

   macOS / Linux:
     cd demo-fixtures && zip -r ../demo.zip cobol-java-demo/

2. Open the app at http://localhost:5173

3. Upload demo.zip using the "Upload ZIP" tab.

4. The analysis should complete in ~30 seconds (depending on Bob's response time).

Expected results:
  - Health score: ~45–60 (Medium risk)
  - 2 high-risk files (CustomerService.java, CUSTINQY.cbl)
  - 2 low-risk files (Customer.java, CUSTCOPY.cbl)
  - Dependency edges: CustomerService → Customer, CUSTINQY → CUSTCOPY (COPY)
  - Bob suggestions for CustomerService.java and CUSTINQY.cbl
