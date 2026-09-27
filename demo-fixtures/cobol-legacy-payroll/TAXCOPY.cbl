      *----------------------------------------------------------------*
      * TAXCOPY.cbl — Tax-band constants copybook.
      * Included via COPY TAXCOPY in PAYROLL.cbl.
      *----------------------------------------------------------------*
       01  WS-TAX-BANDS.
           05 WS-BAND-1-LOW      PIC 9(7)V99  VALUE 0.
           05 WS-BAND-1-HIGH     PIC 9(7)V99  VALUE 12570.00.
           05 WS-BAND-2-LOW      PIC 9(7)V99  VALUE 12570.01.
           05 WS-BAND-2-HIGH     PIC 9(7)V99  VALUE 50270.00.
           05 WS-BAND-3-LOW      PIC 9(7)V99  VALUE 50270.01.
           05 WS-BAND-3-HIGH     PIC 9(8)V99  VALUE 99999999.99.
           05 WS-BAND-1-RATE     PIC 9(2)V99  VALUE 0.00.
           05 WS-BAND-2-RATE     PIC 9(2)V99  VALUE 20.00.
           05 WS-BAND-3-RATE     PIC 9(2)V99  VALUE 40.00.
