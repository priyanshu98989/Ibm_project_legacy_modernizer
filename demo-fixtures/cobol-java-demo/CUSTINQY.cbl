      *> -------------------------------------------------------
      *> CUSTINQY.cbl — Customer Inquiry Program (demo fixture)
      *> A deliberately messy COBOL program for demo purposes.
      *> Contains: GO TO spaghetti, EXEC SQL, hardcoded literals.
      *> -------------------------------------------------------
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CUSTINQY.
       AUTHOR.     Legacy Systems Inc.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT CUSTOMER-FILE ASSIGN TO '/data/customers.dat'
               ORGANIZATION IS INDEXED
               ACCESS MODE  IS RANDOM
               RECORD KEY   IS CUST-ID.

       DATA DIVISION.
       FILE SECTION.
       FD  CUSTOMER-FILE.
       01  CUSTOMER-RECORD.
           05 CUST-ID      PIC 9(8).
           05 CUST-NAME    PIC X(30).
           05 CUST-BALANCE PIC S9(9)V99 COMP-3.
           05 CUST-STATUS  PIC X(1).

       WORKING-STORAGE SECTION.
       01  WS-RETURN-CODE  PIC 9(4) VALUE 0.
       01  WS-HOST         PIC X(15) VALUE '192.168.1.100'.
       01  WS-SQLCODE      PIC S9(9) COMP.

       COPY CUSTCOPY.

       PROCEDURE DIVISION.
       MAIN-LOGIC.
           PERFORM OPEN-FILES
           PERFORM PROCESS-INQUIRIES UNTIL CUST-STATUS = 'X'
           GO TO END-PROGRAM.

       OPEN-FILES.
           OPEN INPUT CUSTOMER-FILE.
           IF WS-RETURN-CODE NOT = 0
               GO TO FILE-ERROR.

       PROCESS-INQUIRIES.
           EXEC SQL
               SELECT CUST_NAME, CUST_BALANCE
               INTO   :CUST-NAME, :CUST-BALANCE
               FROM   CUSTOMERS
               WHERE  CUST_ID = :CUST-ID
           END-EXEC.
           IF SQLCODE NOT = 0
               GO TO SQL-ERROR.
           PERFORM VALIDATE-CUSTOMER.
           PERFORM DISPLAY-RESULTS.

       VALIDATE-CUSTOMER.
           IF CUST-STATUS = 'A'
               PERFORM CHECK-BALANCE
           ELSE
               IF CUST-STATUS = 'S'
                   PERFORM CHECK-SUSPENDED
               ELSE
                   IF CUST-STATUS = 'C'
                       PERFORM CHECK-CLOSED
                   ELSE
                       GO TO UNKNOWN-STATUS.

       CHECK-BALANCE.
           IF CUST-BALANCE < 0
               PERFORM OVERDRAFT-HANDLING.

       CHECK-SUSPENDED.
           MOVE 'SUSPENDED' TO WS-RETURN-CODE.

       CHECK-CLOSED.
           MOVE 'CLOSED' TO WS-RETURN-CODE.

       DISPLAY-RESULTS.
           DISPLAY CUST-NAME ' : ' CUST-BALANCE.

       OVERDRAFT-HANDLING.
           CALL 'NOTIFYPRG' USING CUST-ID CUST-BALANCE.
           CALL 'AUDITLOG' USING CUST-ID.

       FILE-ERROR.
           DISPLAY 'FILE ERROR: ' WS-RETURN-CODE.
           STOP RUN.

       SQL-ERROR.
           DISPLAY 'SQL ERROR: ' WS-SQLCODE.
           STOP RUN.

       UNKNOWN-STATUS.
           DISPLAY 'UNKNOWN STATUS'.

       END-PROGRAM.
           CLOSE CUSTOMER-FILE.
           STOP RUN.
