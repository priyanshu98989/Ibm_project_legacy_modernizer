       IDENTIFICATION DIVISION.
       PROGRAM-ID. MESSYPGM.
      *----------------------------------------------------------------*
      * MESSYPGM — deliberately legacy/broken COBOL for parser tests.
      *
      * PURPOSE:
      *   Should trigger EVERY COBOL risk rule:
      *   - Multiple GO TO statements (spaghetti flow)
      *   - ALTER statement (obsolete)
      *   - NEXT SENTENCE (obsolete)
      *   - EXEC SQL (embedded SQL)
      *   - Hardcoded file paths and IP literals
      *   - Display-numeric PIC without COMP
      *   - MOVE SPACES / MOVE ZEROS (figurative constants)
      *   - Deep PERFORM nesting
      *
      * Also includes deliberately malformed whitespace and mixed-case
      * to confirm the parser handles it without crashing.
      *----------------------------------------------------------------*
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT CUST-FILE ASSIGN TO '/data/legacy/CUSTFILE.DAT'.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-FLAG             PIC X(1).
       01 WS-COUNT            PIC 9(5).
       01 WS-AMOUNT           PIC 9(9)V99.
       01 WS-INTEREST         PIC S9(7)V99.
       01 WS-TAX              PIC 9(5)V9.
       01 WS-TOTAL            PIC 9(11)V99.
       01 WS-SERVER-IP        PIC X(20) VALUE '192.168.1.100'.
       01 WS-DB-PATH          PIC X(50) VALUE '/db2/data/legacy.db'.

       PROCEDURE DIVISION.
       MAIN-PARA.
           MOVE SPACES TO WS-FLAG
           MOVE ZEROS  TO WS-COUNT
           MOVE ZEROS  TO WS-AMOUNT

           ALTER CALC-PARA TO PROCEED TO ERROR-PARA

           PERFORM INIT-PARA
           PERFORM CALC-PARA
           PERFORM LOOP-PARA
           PERFORM LOOP-PARA
           PERFORM LOOP-PARA
           PERFORM LOOP-PARA
           PERFORM LOOP-PARA
           PERFORM LOOP-PARA
           PERFORM LOOP-PARA
           PERFORM LOOP-PARA
           PERFORM LOOP-PARA
           GO TO END-PARA.

       INIT-PARA.
           EXEC SQL
               SELECT COUNT(*) INTO :WS-COUNT
               FROM CUSTOMER
           END-EXEC.

           IF WS-COUNT = 0
               NEXT SENTENCE
           ELSE
               MOVE 'Y' TO WS-FLAG
           END-IF.

       CALC-PARA.
           IF WS-AMOUNT > 0
               GO TO CALC-PARA
           END-IF.

       LOOP-PARA.
           PERFORM INNER-PARA UNTIL WS-COUNT > 100.

       INNER-PARA.
           ADD 1 TO WS-COUNT
           GO TO LOOP-PARA.

       ERROR-PARA.
           DISPLAY 'ERROR: ' WS-FLAG
           GO TO END-PARA.

       END-PARA.
           STOP RUN.
