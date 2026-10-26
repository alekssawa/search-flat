export interface FlatAd {
  id: string;
  title: string;
  price: string;
  url: string;
  images: string[];
  description?: string;
  author?: string;
  agency?: string;
  rooms?: string;
  area?: string;
  floor?: string;
  address?: string;
  date?: string;
  postedAt?: string;
  postedDate?: string;
  pets?: string;
  amenities?: string[];
  isTranslated?: boolean;
}

export interface FeatureValue {
  id?: number;
  value?: any;
}

export interface RawAdvert {
  id: string | number;
  title?: string;
  price?: FeatureValue;
  images?: {
    id?: number;
    value?: string[];
  };
  body?: FeatureValue;
  author?: FeatureValue;
  agency?: FeatureValue;
  pets?: FeatureValue;
  estateRooms?: FeatureValue;
  estateArea?: FeatureValue;
  estateFloor?: FeatureValue;
  totalFloors?: FeatureValue;
  city?: FeatureValue;
  district?: FeatureValue;
  street?: FeatureValue;
  condition?: FeatureValue;
  balcony?: FeatureValue;
  f_188?: FeatureValue; // Меблированная
  f_214?: FeatureValue; // С бытовой техникой
  f_154?: FeatureValue; // Автономное отопление
  f_182?: FeatureValue; // Кондиционер
  posted?: string;
  postedDate?: string;
  reseted?: string;
  state?: string;
  isExpired?: boolean;
}

export interface GraphQLSearchAdsResponse {
  data?: {
    searchAds?: {
      ads?: RawAdvert[];
      count?: number;
    };
  };
  errors?: Array<{
    message: string;
    path?: string[];
  }>;
}
