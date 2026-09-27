      *----------------------------------------------------------------*
      * EMPCOPY.cbl — Employee working-storage copybook.
      * Included via COPY EMPCOPY in PAYROLL.cbl.
      *----------------------------------------------------------------*
       01  WS-EMPLOYEE-WORK.
           05 WS-EMP-FULL-NAME   PIC X(60).
           05 WS-EMP-DEPT-DESC   PIC X(30).
           05 WS-EMP-STATUS      PIC X(1).
           05 WS-EMP-START-DATE  PIC 9(8).
           05 WS-EMP-ANNUAL-SAL  PIC 9(9)V99.
           05 WS-EMP-YTD-GROSS   PIC 9(9)V99.
           05 WS-EMP-YTD-TAX     PIC 9(8)V99.
           05 WS-EMP-PENSION-YTD PIC 9(7)V99.
