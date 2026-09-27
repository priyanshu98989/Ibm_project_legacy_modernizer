       IDENTIFICATION DIVISION.
       PROGRAM-ID. PAYROLL.
       AUTHOR.     LEGACY SYSTEMS DEPT.
      *----------------------------------------------------------------*
      * PAYROLL.cbl — Main payroll processing program.
      *
      * Realistic legacy COBOL — modelled on patterns commonly found in
      * 1980s-1990s mainframe batch payroll systems:
      *   - Multiple GO TO statements (spaghetti flow)
      *   - NEXT SENTENCE (obsolete)
      *   - Display-numeric PIC without COMP
      *   - Hardcoded paths and server addresses
      *   - Deeply nested PERFORM structure
      *   - EXEC SQL with embedded DB2 calls
      *   - CALL to sub-programs (dependency edges)
      *   - COPY copybooks (more dependency edges)
      *----------------------------------------------------------------*
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT EMPLOYEE-FILE  ASSIGN TO '/data/payroll/EMPFILE.DAT'
               ORGANIZATION IS SEQUENTIAL.
           SELECT PAYSLIP-FILE   ASSIGN TO '/data/payroll/PAYSLIP.OUT'
               ORGANIZATION IS SEQUENTIAL.
           SELECT ERROR-LOG      ASSIGN TO '/data/payroll/ERRLOG.TXT'
               ORGANIZATION IS SEQUENTIAL.

       DATA DIVISION.
       FILE SECTION.
       FD  EMPLOYEE-FILE.
       01  EMPLOYEE-REC.
           05 EMP-ID            PIC 9(6).
           05 EMP-NAME          PIC X(30).
           05 EMP-DEPT          PIC X(4).
           05 EMP-BASE-SALARY   PIC 9(7)V99.
           05 EMP-HOURS-WORKED  PIC 9(3)V9.
           05 EMP-TAX-CODE      PIC X(3).

       FD  PAYSLIP-FILE.
       01  PAYSLIP-REC          PIC X(132).

       FD  ERROR-LOG.
       01  ERROR-REC            PIC X(80).

       WORKING-STORAGE SECTION.
       01  WS-EOF-FLAG          PIC X(1)  VALUE 'N'.
       01  WS-ERROR-FLAG        PIC X(1)  VALUE 'N'.
       01  WS-PROCESSED-COUNT   PIC 9(6)  VALUE ZERO.
       01  WS-ERROR-COUNT       PIC 9(4)  VALUE ZERO.
       01  WS-GROSS-PAY         PIC 9(8)V99 VALUE ZERO.
       01  WS-NET-PAY           PIC 9(8)V99 VALUE ZERO.
       01  WS-TAX-AMOUNT        PIC 9(7)V99 VALUE ZERO.
       01  WS-PENSION-AMT       PIC 9(6)V99 VALUE ZERO.
       01  WS-OVERTIME-PAY      PIC 9(6)V99 VALUE ZERO.
       01  WS-HOURLY-RATE       PIC 9(5)V99 VALUE ZERO.
       01  WS-SQLCODE           PIC S9(9) COMP VALUE ZERO.
       01  WS-DB-SERVER         PIC X(20) VALUE '10.0.0.50'.
       01  WS-DB-PORT           PIC X(5)  VALUE '50000'.
       01  WS-RETURN-CODE       PIC 9(4)  VALUE ZERO.

       COPY EMPCOPY.
       COPY TAXCOPY.

       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM INITIALISE-PARA
           PERFORM OPEN-FILES-PARA
           IF WS-ERROR-FLAG = 'Y'
               GO TO ERROR-EXIT-PARA
           END-IF
           PERFORM PROCESS-EMPLOYEES-PARA
               UNTIL WS-EOF-FLAG = 'Y'
           PERFORM CLOSE-FILES-PARA
           PERFORM FINAL-REPORT-PARA
           GO TO END-PROGRAM-PARA.

       INITIALISE-PARA.
           MOVE ZEROS TO WS-PROCESSED-COUNT
           MOVE ZEROS TO WS-ERROR-COUNT
           MOVE ZEROS TO WS-GROSS-PAY
           MOVE SPACES TO WS-ERROR-FLAG
           EXEC SQL
               CONNECT TO PAYDB
               AT     :WS-DB-SERVER
           END-EXEC
           IF SQLCODE NOT = 0
               MOVE 'Y' TO WS-ERROR-FLAG
               GO TO END-PROGRAM-PARA
           END-IF.

       OPEN-FILES-PARA.
           OPEN INPUT  EMPLOYEE-FILE
           OPEN OUTPUT PAYSLIP-FILE
           OPEN OUTPUT ERROR-LOG
           IF WS-RETURN-CODE NOT = ZERO
               MOVE 'Y' TO WS-ERROR-FLAG.

       PROCESS-EMPLOYEES-PARA.
           READ EMPLOYEE-FILE
               AT END
                   MOVE 'Y' TO WS-EOF-FLAG
               NOT AT END
                   PERFORM VALIDATE-EMPLOYEE-PARA
                   IF WS-ERROR-FLAG = 'N'
                       PERFORM CALCULATE-PAY-PARA
                       PERFORM APPLY-DEDUCTIONS-PARA
                       PERFORM WRITE-PAYSLIP-PARA
                       ADD 1 TO WS-PROCESSED-COUNT
                   ELSE
                       ADD 1 TO WS-ERROR-COUNT
                       MOVE 'N' TO WS-ERROR-FLAG
                   END-IF
           END-READ.

       VALIDATE-EMPLOYEE-PARA.
           IF EMP-ID = ZEROS
               MOVE 'Y' TO WS-ERROR-FLAG
               NEXT SENTENCE
           ELSE
               IF EMP-NAME = SPACES
                   MOVE 'Y' TO WS-ERROR-FLAG
               ELSE
                   IF EMP-DEPT = SPACES
                       NEXT SENTENCE
                   ELSE
                       PERFORM LOOKUP-DEPT-PARA
                   END-IF
               END-IF
           END-IF.

       CALCULATE-PAY-PARA.
           PERFORM CALC-HOURLY-RATE-PARA
           PERFORM CALC-GROSS-PAY-PARA
           IF WS-GROSS-PAY > 50000
               PERFORM CALC-HIGH-EARNER-PARA
           ELSE
               IF WS-GROSS-PAY > 30000
                   PERFORM CALC-STANDARD-PARA
               ELSE
                   IF WS-GROSS-PAY > 10000
                       PERFORM CALC-LOW-EARNER-PARA
                   ELSE
                       IF WS-GROSS-PAY > 0
                           PERFORM CALC-MINIMUM-PARA
                       ELSE
                           GO TO ZERO-PAY-PARA
                       END-IF
                   END-IF
               END-IF
           END-IF.

       CALC-HOURLY-RATE-PARA.
           DIVIDE EMP-BASE-SALARY BY 2080 GIVING WS-HOURLY-RATE.

       CALC-GROSS-PAY-PARA.
           MULTIPLY WS-HOURLY-RATE BY EMP-HOURS-WORKED
               GIVING WS-GROSS-PAY.
           IF EMP-HOURS-WORKED > 40
               COMPUTE WS-OVERTIME-PAY =
                   (EMP-HOURS-WORKED - 40) * WS-HOURLY-RATE * 0.5
               ADD WS-OVERTIME-PAY TO WS-GROSS-PAY
           END-IF.

       CALC-HIGH-EARNER-PARA.
           CALL 'TAXTIER3' USING WS-GROSS-PAY WS-TAX-AMOUNT.

       CALC-STANDARD-PARA.
           CALL 'TAXTIER2' USING WS-GROSS-PAY WS-TAX-AMOUNT.

       CALC-LOW-EARNER-PARA.
           CALL 'TAXTIER1' USING WS-GROSS-PAY WS-TAX-AMOUNT.

       CALC-MINIMUM-PARA.
           MOVE ZEROS TO WS-TAX-AMOUNT.

       APPLY-DEDUCTIONS-PARA.
           EXEC SQL
               SELECT PENSION_RATE INTO :WS-PENSION-AMT
               FROM   PENSION_TIERS
               WHERE  DEPT_CODE = :EMP-DEPT
           END-EXEC
           IF SQLCODE NOT = 0
               MOVE ZEROS TO WS-PENSION-AMT
           END-IF
           COMPUTE WS-NET-PAY =
               WS-GROSS-PAY - WS-TAX-AMOUNT - WS-PENSION-AMT.

       LOOKUP-DEPT-PARA.
           CALL 'DEPTLKUP' USING EMP-DEPT WS-RETURN-CODE.

       WRITE-PAYSLIP-PARA.
           MOVE EMP-NAME TO PAYSLIP-REC
           WRITE PAYSLIP-REC.

       FINAL-REPORT-PARA.
           CALL 'RPTGEN' USING WS-PROCESSED-COUNT WS-ERROR-COUNT.

       ZERO-PAY-PARA.
           MOVE 'Y' TO WS-ERROR-FLAG
           GO TO END-PROGRAM-PARA.

       ERROR-EXIT-PARA.
           DISPLAY 'FATAL ERROR — PAYROLL ABORTED'
           DISPLAY 'DB SERVER: ' WS-DB-SERVER
           STOP RUN.

       CLOSE-FILES-PARA.
           CLOSE EMPLOYEE-FILE
           CLOSE PAYSLIP-FILE
           CLOSE ERROR-LOG.

       END-PROGRAM-PARA.
           DISPLAY 'PAYROLL COMPLETE. PROCESSED: ' WS-PROCESSED-COUNT
           STOP RUN.
