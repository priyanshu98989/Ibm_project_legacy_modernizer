package com.bank.model;

import java.util.Vector;

/**
 * Account.java — Legacy bank account model.
 * Uses Vector (pre-Java-5 collection), raw types, manual serialisation.
 */
public class Account {

    private int    accountNumber;
    private String accountType;
    private double balance;
    private String ownerName;
    private Vector transactionHistory;   // raw Vector — no generics

    public Account(int accountNumber, String accountType, String ownerName) {
        this.accountNumber    = accountNumber;
        this.accountType      = accountType;
        this.ownerName        = ownerName;
        this.balance          = 0.0;
        this.transactionHistory = new Vector();  // legacy collection
    }

    public void recordTransaction(String desc) {
        transactionHistory.addElement(desc);     // raw add
    }

    public java.util.Enumeration getTransactions() {
        return transactionHistory.elements();    // returns raw Enumeration
    }

    public int    getAccountNumber() { return accountNumber; }
    public String getAccountType()   { return accountType;   }
    public String getOwnerName()     { return ownerName;     }
    public double getBalance()       { return balance;       }
    public void   setBalance(double b){ this.balance = b;    }
}
