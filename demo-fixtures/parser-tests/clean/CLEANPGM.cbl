       IDENTIFICATION DIVISION.
       PROGRAM-ID. CLEANPGM.
      *----------------------------------------------------------------*
      * CLEANPGM - A modern, well-structured COBOL program.
      *
      * PURPOSE (for parser tests):
      *   This file should produce ZERO risk issues from the static parser.
      *   - No unconditional branch statements
      *   - No obsolete ALTER verb
      *   - No obsolete NEXT-SENTENCE verb
      *   - No embedded SQL blocks
      *   - No hardcoded file paths or IPs
      *   - Arithmetic fields use COMP-3 (PACKED-DECIMAL)
      *   - PERFORM nesting is shallow
      *----------------------------------------------------------------*
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT CUSTOMER-FILE ASSIGN TO CUSTFILE
               ORGANIZATION IS SEQUENTIAL.

       DATA DIVISION.
       FILE SECTION.
       FD CUSTOMER-FILE.
       01 CUSTOMER-REC.
           05 CUST-ID         PIC X(10).
           05 CUST-NAME       PIC X(40).

       WORKING-STORAGE SECTION.
       01 WS-EOF-FLAG         PIC X(1)   VALUE 'N'.
       01 WS-COUNT            PIC 9(5)   COMP-3 VALUE ZERO.
       01 WS-TOTAL-AMT        PIC S9(9)V99 COMP-3 VALUE ZERO.
       01 WS-RETURN-CODE      PIC 9(2)   COMP VALUE ZERO.

       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM OPEN-FILES
           PERFORM PROCESS-RECORDS UNTIL WS-EOF-FLAG = 'Y'
           PERFORM CLOSE-FILES
           STOP RUN.

       OPEN-FILES.
           OPEN INPUT CUSTOMER-FILE.

       PROCESS-RECORDS.
           READ CUSTOMER-FILE
               AT END MOVE 'Y' TO WS-EOF-FLAG
               NOT AT END PERFORM PROCESS-ONE-RECORD
           END-READ.

       PROCESS-ONE-RECORD.
           ADD 1 TO WS-COUNT.

       CLOSE-FILES.
           CLOSE CUSTOMER-FILE.
