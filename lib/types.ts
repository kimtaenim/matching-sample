export type Location = "봉천동" | "과천" | "대치동";
export type CareType = "아동" | "노인" | "치매노인" | "장애인" | "환자";
export type Gender = "무관" | "남" | "여";

export interface Review {
  from?: string;
  to?: string;
  date: string;
  rating: number;
  text: string;
}

export interface Helper {
  id: string;
  name: string;
  location: Location;
  bio: string;
  parsed: {
    wage_min: number;
    care_type: CareType[];
    hours: string;
    preferred_gender: Gender;
    age: number;
  };
  reviews_received: Review[];
  reviews_written: Review[];
}

export interface Family {
  id: string;
  location: Location;
  bio: string;
  parsed: {
    wage_max: number;
    care_type: CareType;
    hours: string;
    preferred_gender: Gender;
    care_age: number;
  };
  reviews_received: Review[];
  reviews_written: Review[];
}

export interface Match {
  id: string;
  helper_id: string;
  family_id: string;
  date: string;
  status: string;
  match_reason: string;
  review_helper: { rating: number; text: string };
  review_family: { rating: number; text: string };
}

export interface TokenDelta {
  input: number;
  output: number;
}

export interface ApiUsageResponse {
  _usage?: TokenDelta;
}
