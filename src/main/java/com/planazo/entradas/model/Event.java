package com.planazo.entradas.model;

public record Event(long id, String type, String title, String venue, String city, String date,
                    String time, int price, String image, String accent, boolean featured) {
}
