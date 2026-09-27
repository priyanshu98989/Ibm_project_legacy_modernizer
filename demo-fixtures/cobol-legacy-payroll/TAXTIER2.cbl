       IDENTIFICATION DIVISION.
       PROGRAM-ID. TAXTIER2.
      *----------------------------------------------------------------*
      * TAXTIER2.cbl — Standard tax-rate calculation sub-program.
      * Called by PAYROLL via CALL 'TAXTIER2'.
      *----------------------------------------------------------------*
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-TAX-RATE          PIC 9(2)V9(4) VALUE 0.2000.
       01  WS-THRESHOLD-1       PIC 9(7)V99   VALUE 12570.00.
       01  WS-THRESHOLD-2       PIC 9(7)V99   VALUE 50270.00.
       01  WS-TAXABLE           PIC 9(8)V99   VALUE ZERO.
       01  WS-DB-FALLBACK       PIC X(20)     VALUE '10.0.0.50'.

       LINKAGE SECTION.
       01  LK-GROSS-PAY         PIC 9(8)V99.
       01  LK-TAX-AMOUNT        PIC 9(7)V99.

       PROCEDURE DIVISION USING LK-GROSS-PAY LK-TAX-AMOUNT.
       MAIN-PARA.
           IF LK-GROSS-PAY > WS-THRESHOLD-1
               COMPUTE WS-TAXABLE = LK-GROSS-PAY - WS-THRESHOLD-1
               COMPUTE LK-TAX-AMOUNT = WS-TAXABLE * WS-TAX-RATE
           ELSE
               MOVE ZEROS TO LK-TAX-AMOUNT
           END-IF.

           EXEC SQL
               INSERT INTO TAX_AUDIT (GROSS, TAX, CALC_DATE)
               VALUES (:LK-GROSS-PAY, :LK-TAX-AMOUNT, CURRENT DATE)
           END-EXEC.

           GOBACK.
